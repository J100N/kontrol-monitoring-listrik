#ifndef PZEM_H
#define PZEM_H

#include <stdbool.h>
#include <stdint.h>

#include "driver/uart.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Default slave address PZEM-004T v3 untuk single-device di jalur Modbus.
#define PZEM_DEFAULT_SLAVE_ADDR 0xF8

// Default mapping UART sesuai wiring yang Anda tentukan.
#define PZEM_DEFAULT_UART_PORT UART_NUM_1
#define PZEM_DEFAULT_TX_GPIO 17
#define PZEM_DEFAULT_RX_GPIO 18

typedef struct {
	uart_port_t uart_num;
	int tx_gpio;
	int rx_gpio;
	int baud_rate;
	uint8_t slave_addr;
	uint32_t response_timeout_ms;
} pzem_config_t;

typedef struct {
	float voltage_v;
	float current_a;
	float power_w;
	float energy_wh;
	float frequency_hz;
	float power_factor;
	uint16_t alarm_status;
} pzem_data_t;

// Inisialisasi driver PZEM.
// Jika config bernilai NULL, driver memakai konfigurasi default komponen.
esp_err_t pzem_init(const pzem_config_t *config);

// Lepas driver UART PZEM ketika tidak dipakai.
esp_err_t pzem_deinit(void);

// Membaca 1 paket lengkap parameter listrik dari PZEM.
esp_err_t pzem_read_data(pzem_data_t *out_data);

// Reset akumulator energi (energy_wh) PZEM kembali ke 0 (perintah Modbus 0x42).
// Hanya berhasil bila PZEM bertenaga (relay ON); bila tidak, akan timeout.
esp_err_t pzem_reset_energy(void);

// Memeriksa apakah driver PZEM sudah aktif.
bool pzem_is_initialized(void);

#ifdef __cplusplus
}
#endif

#endif

