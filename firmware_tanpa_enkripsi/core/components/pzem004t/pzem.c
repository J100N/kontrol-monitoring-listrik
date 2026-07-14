#include "pzem.h"

#include <string.h>

#include "driver/uart.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"

/*
 * Referensi implementasi:
 * 1) ESP-IDF UART API (resmi Espressif):
 *    https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/uart.html
 * 2) Protokol PZEM-004T v3 (Modbus RTU) dan pemetaan register umum:
 *    https://github.com/mandulaj/PZEM-004T-v30
 */

#define PZEM_FN_READ_INPUT_REG 0x04
#define PZEM_FN_RESET_ENERGY 0x42
#define PZEM_REG_START_ADDR 0x0000
#define PZEM_REG_COUNT 0x000A

#define PZEM_REQUEST_SIZE 8
#define PZEM_RESPONSE_DATA_BYTES 20
#define PZEM_RESPONSE_SIZE (3 + PZEM_RESPONSE_DATA_BYTES + 2)

#define PZEM_UART_RX_BUFFER_SIZE 256

static const char *TAG = "pzem004t";

// Konfigurasi default komponen, mengikuti wiring yang Anda tetapkan.
static const pzem_config_t PZEM_DEFAULT_CONFIG = {
	.uart_num = PZEM_DEFAULT_UART_PORT,
	.tx_gpio = PZEM_DEFAULT_TX_GPIO,
	.rx_gpio = PZEM_DEFAULT_RX_GPIO,
	.baud_rate = 9600,
	.slave_addr = PZEM_DEFAULT_SLAVE_ADDR,
	.response_timeout_ms = 1000,
};

// Status runtime internal driver.
static bool s_initialized = false;
static pzem_config_t s_cfg;

// Hitung CRC16 Modbus (poly 0xA001, little-endian pada frame).
static uint16_t pzem_crc16_modbus(const uint8_t *data, size_t len)
{
	uint16_t crc = 0xFFFF;

	for (size_t i = 0; i < len; i++) {
		crc ^= data[i];
		for (int bit = 0; bit < 8; bit++) {
			if (crc & 0x0001) {
				crc >>= 1;
				crc ^= 0xA001;
			} else {
				crc >>= 1;
			}
		}
	}

	return crc;
}

// Ambil nilai uint16 big-endian dari buffer respons PZEM.
static uint16_t pzem_u16_be(const uint8_t *buf, int idx)
{
	return (uint16_t)(((uint16_t)buf[idx] << 8) | buf[idx + 1]);
}

// Baca byte UART hingga panjang terpenuhi atau timeout global tercapai.
static esp_err_t pzem_uart_read_exact(uart_port_t uart_num, uint8_t *out, size_t len, uint32_t timeout_ms)
{
	size_t total = 0;
	int64_t deadline_us = esp_timer_get_time() + ((int64_t)timeout_ms * 1000);

	while (total < len) {
		int64_t now_us = esp_timer_get_time();
		if (now_us >= deadline_us) {
			return ESP_ERR_TIMEOUT;
		}

		int64_t remain_us = deadline_us - now_us;
		TickType_t wait_ticks = pdMS_TO_TICKS((uint32_t)(remain_us / 1000));
		if (wait_ticks == 0) {
			wait_ticks = 1;
		}

		int read_len = uart_read_bytes(uart_num, out + total, (uint32_t)(len - total), wait_ticks);
		if (read_len < 0) {
			return ESP_FAIL;
		}

		total += (size_t)read_len;
	}

	return ESP_OK;
}

// Susun frame request baca register input (function code 0x04).
static void pzem_build_read_frame(uint8_t slave_addr, uint8_t out_frame[PZEM_REQUEST_SIZE])
{
	out_frame[0] = slave_addr;
	out_frame[1] = PZEM_FN_READ_INPUT_REG;
	out_frame[2] = (uint8_t)(PZEM_REG_START_ADDR >> 8);
	out_frame[3] = (uint8_t)(PZEM_REG_START_ADDR & 0xFF);
	out_frame[4] = (uint8_t)(PZEM_REG_COUNT >> 8);
	out_frame[5] = (uint8_t)(PZEM_REG_COUNT & 0xFF);

	uint16_t crc = pzem_crc16_modbus(out_frame, 6);
	out_frame[6] = (uint8_t)(crc & 0xFF);
	out_frame[7] = (uint8_t)(crc >> 8);
}

// Validasi header dan CRC respons dari modul PZEM.
static esp_err_t pzem_validate_response(const uint8_t resp[PZEM_RESPONSE_SIZE], uint8_t expected_addr)
{
	if (resp[0] != expected_addr) {
		ESP_LOGE(TAG, "alamat slave mismatch: expected=0x%02X got=0x%02X", expected_addr, resp[0]);
		return ESP_ERR_INVALID_RESPONSE;
	}

	if (resp[1] != PZEM_FN_READ_INPUT_REG) {
		ESP_LOGE(TAG, "function code mismatch: expected=0x%02X got=0x%02X", PZEM_FN_READ_INPUT_REG, resp[1]);
		return ESP_ERR_INVALID_RESPONSE;
	}

	if (resp[2] != PZEM_RESPONSE_DATA_BYTES) {
		ESP_LOGE(TAG, "ukuran payload tidak valid: expected=%u got=%u", PZEM_RESPONSE_DATA_BYTES, resp[2]);
		return ESP_ERR_INVALID_SIZE;
	}

	uint16_t crc_calc = pzem_crc16_modbus(resp, PZEM_RESPONSE_SIZE - 2);
	uint16_t crc_recv = (uint16_t)((uint16_t)resp[PZEM_RESPONSE_SIZE - 1] << 8) | resp[PZEM_RESPONSE_SIZE - 2];
	if (crc_calc != crc_recv) {
		ESP_LOGE(TAG, "crc mismatch: expected=0x%04X got=0x%04X", crc_calc, crc_recv);
		return ESP_ERR_INVALID_CRC;
	}

	return ESP_OK;
}

bool pzem_is_initialized(void)
{
	return s_initialized;
}

esp_err_t pzem_init(const pzem_config_t *config)
{
	// Pilih config default jika pemanggil tidak memberikan konfigurasi khusus.
	s_cfg = (config != NULL) ? *config : PZEM_DEFAULT_CONFIG;

	ESP_RETURN_ON_FALSE(s_cfg.uart_num >= UART_NUM_0 && s_cfg.uart_num < UART_NUM_MAX, ESP_ERR_INVALID_ARG, TAG, "uart_num tidak valid");
	ESP_RETURN_ON_FALSE(s_cfg.tx_gpio >= 0 && s_cfg.rx_gpio >= 0, ESP_ERR_INVALID_ARG, TAG, "tx/rx gpio tidak valid");
	ESP_RETURN_ON_FALSE(s_cfg.baud_rate > 0, ESP_ERR_INVALID_ARG, TAG, "baud rate tidak valid");
	ESP_RETURN_ON_FALSE(s_cfg.response_timeout_ms > 0, ESP_ERR_INVALID_ARG, TAG, "timeout harus > 0");

	if (s_initialized) {
		ESP_LOGW(TAG, "pzem sudah diinisialisasi, lewati init ulang");
		return ESP_OK;
	}

	// Konfigurasi parameter UART: PZEM memakai 9600 8N1 tanpa flow control.
	uart_config_t uart_cfg = {
		.baud_rate = s_cfg.baud_rate,
		.data_bits = UART_DATA_8_BITS,
		.parity = UART_PARITY_DISABLE,
		.stop_bits = UART_STOP_BITS_1,
		.flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
		.rx_flow_ctrl_thresh = 0,
		.source_clk = UART_SCLK_DEFAULT,
	};

	ESP_RETURN_ON_ERROR(uart_param_config(s_cfg.uart_num, &uart_cfg), TAG, "uart_param_config gagal");

	// Mapping pin sesuai wiring: TX ESP -> RX PZEM, RX ESP -> TX PZEM.
	ESP_RETURN_ON_ERROR(
		uart_set_pin(s_cfg.uart_num, s_cfg.tx_gpio, s_cfg.rx_gpio, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE),
		TAG,
		"uart_set_pin gagal");

	// Install driver UART (RX buffer aktif, TX buffer non-ring agar sederhana).
	ESP_RETURN_ON_ERROR(
		uart_driver_install(s_cfg.uart_num, PZEM_UART_RX_BUFFER_SIZE, 0, 0, NULL, 0),
		TAG,
		"uart_driver_install gagal");

	ESP_RETURN_ON_ERROR(uart_flush_input(s_cfg.uart_num), TAG, "uart_flush_input gagal");

	s_initialized = true;

	ESP_LOGI(
		TAG,
		"pzem init ok (uart=%d tx=%d rx=%d addr=0x%02X baud=%d)",
		s_cfg.uart_num,
		s_cfg.tx_gpio,
		s_cfg.rx_gpio,
		s_cfg.slave_addr,
		s_cfg.baud_rate);

	return ESP_OK;
}

esp_err_t pzem_deinit(void)
{
	if (!s_initialized) {
		return ESP_OK;
	}

	ESP_RETURN_ON_ERROR(uart_driver_delete(s_cfg.uart_num), TAG, "uart_driver_delete gagal");
	memset(&s_cfg, 0, sizeof(s_cfg));
	s_initialized = false;

	return ESP_OK;
}

esp_err_t pzem_read_data(pzem_data_t *out_data)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "pzem belum diinisialisasi");
	ESP_RETURN_ON_FALSE(out_data != NULL, ESP_ERR_INVALID_ARG, TAG, "out_data null");

	uint8_t req[PZEM_REQUEST_SIZE] = {0};
	uint8_t resp[PZEM_RESPONSE_SIZE] = {0};

	// Bangun frame request baca register telemetry.
	pzem_build_read_frame(s_cfg.slave_addr, req);

	// Bersihkan buffer RX agar tidak tercampur data lama.
	ESP_RETURN_ON_ERROR(uart_flush_input(s_cfg.uart_num), TAG, "uart_flush_input gagal");

	// Kirim request ke modul PZEM.
	int written = uart_write_bytes(s_cfg.uart_num, req, sizeof(req));
	ESP_RETURN_ON_FALSE(written == (int)sizeof(req), ESP_FAIL, TAG, "uart_write_bytes tidak lengkap");
	ESP_RETURN_ON_ERROR(uart_wait_tx_done(s_cfg.uart_num, pdMS_TO_TICKS(100)), TAG, "uart_wait_tx_done timeout");

	// Baca respons penuh dari modul sesuai format frame PZEM v3.
	ESP_RETURN_ON_ERROR(
		pzem_uart_read_exact(s_cfg.uart_num, resp, sizeof(resp), s_cfg.response_timeout_ms),
		TAG,
		"timeout/gagal membaca respons pzem");

	// Validasi alamat, function code, ukuran payload, dan CRC.
	ESP_RETURN_ON_ERROR(pzem_validate_response(resp, s_cfg.slave_addr), TAG, "respons pzem tidak valid");

	// Parse payload register PZEM menjadi satuan fisik.
	uint16_t voltage_raw = pzem_u16_be(resp, 3);

	uint16_t current_low = pzem_u16_be(resp, 5);
	uint16_t current_high = pzem_u16_be(resp, 7);
	uint32_t current_raw = ((uint32_t)current_high << 16) | current_low;

	uint16_t power_low = pzem_u16_be(resp, 9);
	uint16_t power_high = pzem_u16_be(resp, 11);
	uint32_t power_raw = ((uint32_t)power_high << 16) | power_low;

	uint16_t energy_low = pzem_u16_be(resp, 13);
	uint16_t energy_high = pzem_u16_be(resp, 15);
	uint32_t energy_raw = ((uint32_t)energy_high << 16) | energy_low;

	uint16_t frequency_raw = pzem_u16_be(resp, 17);
	uint16_t pf_raw = pzem_u16_be(resp, 19);
	uint16_t alarm_raw = pzem_u16_be(resp, 21);

	out_data->voltage_v = (float)voltage_raw / 10.0f;
	out_data->current_a = (float)current_raw / 1000.0f;
	out_data->power_w = (float)power_raw / 10.0f;
	out_data->energy_wh = (float)energy_raw;
	out_data->frequency_hz = (float)frequency_raw / 10.0f;
	out_data->power_factor = (float)pf_raw / 100.0f;
	out_data->alarm_status = alarm_raw;

	return ESP_OK;
}

esp_err_t pzem_reset_energy(void)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "pzem belum diinisialisasi");

	// Frame reset energi PZEM-004T v3: [addr][0x42][crc_lo][crc_hi] (4 byte).
	uint8_t req[4] = {0};
	req[0] = s_cfg.slave_addr;
	req[1] = PZEM_FN_RESET_ENERGY;
	uint16_t crc = pzem_crc16_modbus(req, 2);
	req[2] = (uint8_t)(crc & 0xFF);
	req[3] = (uint8_t)(crc >> 8);

	// Bersihkan buffer RX agar balasan tidak tercampur data lama.
	ESP_RETURN_ON_ERROR(uart_flush_input(s_cfg.uart_num), TAG, "uart_flush_input gagal");

	int written = uart_write_bytes(s_cfg.uart_num, req, sizeof(req));
	ESP_RETURN_ON_FALSE(written == (int)sizeof(req), ESP_FAIL, TAG, "uart_write_bytes reset tidak lengkap");
	ESP_RETURN_ON_ERROR(uart_wait_tx_done(s_cfg.uart_num, pdMS_TO_TICKS(100)), TAG, "uart_wait_tx_done timeout");

	// Balasan sukses = echo 4 byte identik. (Balasan error PZEM = 5 byte, fc=0xC2.)
	uint8_t resp[4] = {0};
	ESP_RETURN_ON_ERROR(
		pzem_uart_read_exact(s_cfg.uart_num, resp, sizeof(resp), s_cfg.response_timeout_ms),
		TAG,
		"timeout/gagal membaca balasan reset pzem");

	if (resp[0] != s_cfg.slave_addr || resp[1] != PZEM_FN_RESET_ENERGY) {
		ESP_LOGE(TAG, "balasan reset tidak valid: 0x%02X 0x%02X", resp[0], resp[1]);
		return ESP_ERR_INVALID_RESPONSE;
	}

	uint16_t crc_calc = pzem_crc16_modbus(resp, 2);
	uint16_t crc_recv = (uint16_t)((uint16_t)resp[3] << 8) | resp[2];
	if (crc_calc != crc_recv) {
		ESP_LOGE(TAG, "crc balasan reset mismatch: expected=0x%04X got=0x%04X", crc_calc, crc_recv);
		return ESP_ERR_INVALID_CRC;
	}

	ESP_LOGI(TAG, "energi PZEM berhasil di-reset ke 0");
	return ESP_OK;
}

