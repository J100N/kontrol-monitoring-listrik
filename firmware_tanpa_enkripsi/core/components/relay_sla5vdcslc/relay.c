#include "relay.h"

#include <string.h>

#include "esp_check.h"
#include "esp_log.h"

/*
 * Referensi implementasi:
 * 1) ESP-IDF GPIO API (sumber resmi Espressif):
 *    https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html
 */

static const char *TAG = "relay";

// Konfigurasi default relay.
// active_level = HIGH  -> relay_on() membuat GPIO HIGH = relay NYALA (sesuai hasil tes hardware).
// default_on   = true  -> relay langsung nyala sejak relay_init(), tanpa perlu perintah tambahan.
// CATATAN: kalau suatu saat relay ternyata terbalik (nyala jadi mati), cukup ganti
//          satu baris ini: RELAY_ACTIVE_LEVEL_HIGH -> RELAY_ACTIVE_LEVEL_LOW.
static const relay_config_t RELAY_DEFAULT_CONFIG = {
	.gpio_num = RELAY_DEFAULT_GPIO,
	.active_level = RELAY_ACTIVE_LEVEL_HIGH,
	.default_on = true,
};

// Status runtime internal komponen relay.
static bool s_initialized = false;
static bool s_is_on = false;
static relay_config_t s_cfg;

// Ubah status logis relay menjadi level listrik sesuai active_level.
static inline uint32_t relay_level_from_state(bool on)
{
	return on ? s_cfg.active_level : (uint8_t)!s_cfg.active_level;
}

bool relay_is_initialized(void)
{
	return s_initialized;
}

bool relay_get_state(void)
{
	return s_is_on;
}

esp_err_t relay_set(bool on)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "relay belum diinisialisasi");

	uint32_t level = relay_level_from_state(on);
	ESP_RETURN_ON_ERROR(gpio_set_level(s_cfg.gpio_num, level), TAG, "gpio_set_level gagal");

	s_is_on = on;
	return ESP_OK;
}

esp_err_t relay_on(void)
{
	return relay_set(true);
}

esp_err_t relay_off(void)
{
	return relay_set(false);
}

esp_err_t relay_toggle(void)
{
	return relay_set(!s_is_on);
}

esp_err_t relay_init(const relay_config_t *config)
{
	relay_config_t cfg = (config != NULL) ? *config : RELAY_DEFAULT_CONFIG;

	// Validasi pin output dan parameter active level.
	ESP_RETURN_ON_FALSE(GPIO_IS_VALID_OUTPUT_GPIO(cfg.gpio_num), ESP_ERR_INVALID_ARG, TAG, "gpio relay tidak valid");
	ESP_RETURN_ON_FALSE(
		cfg.active_level == RELAY_ACTIVE_LEVEL_HIGH || cfg.active_level == RELAY_ACTIVE_LEVEL_LOW,
		ESP_ERR_INVALID_ARG,
		TAG,
		"active_level harus 0 atau 1");

	if (s_initialized) {
		ESP_LOGW(TAG, "relay sudah diinisialisasi, lewati init ulang");
		return ESP_OK;
	}

	// Konfigurasi pin sebagai output digital tanpa interrupt.
	gpio_config_t io_cfg = {
		.pin_bit_mask = (1ULL << cfg.gpio_num),
		.mode = GPIO_MODE_OUTPUT,
		.pull_up_en = GPIO_PULLUP_DISABLE,
		.pull_down_en = GPIO_PULLDOWN_DISABLE,
		.intr_type = GPIO_INTR_DISABLE,
	};

	ESP_RETURN_ON_ERROR(gpio_config(&io_cfg), TAG, "gpio_config gagal");

	memset(&s_cfg, 0, sizeof(s_cfg));
	s_cfg = cfg;
	s_initialized = true;

	// Tetapkan kondisi awal relay agar tidak terjadi output tak terduga saat boot.
	ESP_RETURN_ON_ERROR(relay_set(s_cfg.default_on), TAG, "gagal set status awal relay");

	ESP_LOGI(
		TAG,
		"relay init ok (gpio=%d active_level=%u default=%s)",
		s_cfg.gpio_num,
		s_cfg.active_level,
		s_cfg.default_on ? "ON" : "OFF");

	return ESP_OK;
}

esp_err_t relay_deinit(void)
{
	if (!s_initialized) {
		return ESP_OK;
	}

	// Matikan relay dulu untuk kondisi aman sebelum pin di-reset.
	ESP_RETURN_ON_ERROR(relay_off(), TAG, "gagal mematikan relay saat deinit");
	ESP_RETURN_ON_ERROR(gpio_reset_pin(s_cfg.gpio_num), TAG, "gpio_reset_pin gagal");

	memset(&s_cfg, 0, sizeof(s_cfg));
	s_is_on = false;
	s_initialized = false;

	return ESP_OK;
}

