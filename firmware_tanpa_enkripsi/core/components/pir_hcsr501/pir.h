#ifndef PIR_H
#define PIR_H

#include <stdbool.h>
#include <stdint.h>

#include "driver/gpio.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Default pin baca sinyal OUT HC-SR501 di sisi ESP32-S3.
#define PIR_DEFAULT_GPIO GPIO_NUM_4

// Default logika aktif HC-SR501: HIGH saat ada gerakan, LOW saat idle.
#define PIR_ACTIVE_LEVEL_HIGH 1U
#define PIR_ACTIVE_LEVEL_LOW 0U

typedef struct {
	gpio_num_t gpio_num;
	uint8_t active_level;
	bool enable_pullup;
	bool enable_pulldown;
} pir_config_t;

// Inisialisasi input PIR.
// Jika config bernilai NULL, gunakan default: GPIO4 aktif-high.
esp_err_t pir_init(const pir_config_t *config);

// Lepas konfigurasi PIR dan kembalikan pin ke kondisi default.
esp_err_t pir_deinit(void);

// Membaca status logis gerakan: true = gerakan terdeteksi.
bool pir_is_motion_detected(void);

// Membaca level raw GPIO (0/1) untuk kebutuhan debug.
int pir_get_raw_level(void);

// Cek status inisialisasi komponen PIR.
bool pir_is_initialized(void);

#ifdef __cplusplus
}
#endif

#endif

