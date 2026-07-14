#include "pir.h"

#include <string.h>

#include "esp_check.h"
#include "esp_log.h"

/*
 * Referensi implementasi:
 * 1) ESP-IDF GPIO API resmi (Espressif):
 *    https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html
 * 2) Karakteristik logika output HC-SR501 (DOUT high saat trigger):
 *    https://components101.com/sensors/hc-sr501-pir-sensor
 */

static const char *TAG = "pir_hcsr501";

// Default konfigurasi HC-SR501: sinyal output sensor dibaca di GPIO4, aktif-high.
static const pir_config_t PIR_DEFAULT_CONFIG = {
	.gpio_num = PIR_DEFAULT_GPIO,
	.active_level = PIR_ACTIVE_LEVEL_HIGH,
	.enable_pullup = false,
	.enable_pulldown = false,
};

// Status runtime internal komponen PIR.
static bool s_initialized = false;
static pir_config_t s_cfg;

bool pir_is_initialized(void)
{
	return s_initialized;
}

int pir_get_raw_level(void)
{
	if (!s_initialized) {
		return 0;
	}

	return gpio_get_level(s_cfg.gpio_num);
}

bool pir_is_motion_detected(void)
{
	if (!s_initialized) {
		return false;
	}

	// Ubah level listrik GPIO menjadi status logis gerakan.
	int raw = gpio_get_level(s_cfg.gpio_num);
	return (raw == (int)s_cfg.active_level);
}

esp_err_t pir_init(const pir_config_t *config)
{
	pir_config_t cfg = (config != NULL) ? *config : PIR_DEFAULT_CONFIG;

	// Validasi pin dan mode aktif sensor.
	ESP_RETURN_ON_FALSE(GPIO_IS_VALID_GPIO(cfg.gpio_num), ESP_ERR_INVALID_ARG, TAG, "gpio pir tidak valid");
	ESP_RETURN_ON_FALSE(
		cfg.active_level == PIR_ACTIVE_LEVEL_HIGH || cfg.active_level == PIR_ACTIVE_LEVEL_LOW,
		ESP_ERR_INVALID_ARG,
		TAG,
		"active_level harus 0 atau 1");

	if (s_initialized) {
		ESP_LOGW(TAG, "pir sudah diinisialisasi, lewati init ulang");
		return ESP_OK;
	}

	// Konfigurasi pin sebagai input digital untuk membaca sinyal DOUT sensor PIR.
	gpio_config_t io_cfg = {
		.pin_bit_mask = (1ULL << cfg.gpio_num),
		.mode = GPIO_MODE_INPUT,
		.pull_up_en = cfg.enable_pullup ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
		.pull_down_en = cfg.enable_pulldown ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
		.intr_type = GPIO_INTR_DISABLE,
	};

	ESP_RETURN_ON_ERROR(gpio_config(&io_cfg), TAG, "gpio_config gagal");

	memset(&s_cfg, 0, sizeof(s_cfg));
	s_cfg = cfg;
	s_initialized = true;

	ESP_LOGI(
		TAG,
		"pir init ok (gpio=%d active_level=%u pullup=%u pulldown=%u)",
		s_cfg.gpio_num,
		s_cfg.active_level,
		s_cfg.enable_pullup,
		s_cfg.enable_pulldown);

	return ESP_OK;
}

esp_err_t pir_deinit(void)
{
	if (!s_initialized) {
		return ESP_OK;
	}

	ESP_RETURN_ON_ERROR(gpio_reset_pin(s_cfg.gpio_num), TAG, "gpio_reset_pin gagal");

	memset(&s_cfg, 0, sizeof(s_cfg));
	s_initialized = false;

	return ESP_OK;
}

