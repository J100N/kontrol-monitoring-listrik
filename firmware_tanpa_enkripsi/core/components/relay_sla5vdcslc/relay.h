#ifndef RELAY_H
#define RELAY_H

#include <stdbool.h>
#include <stdint.h>

#include "driver/gpio.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Default pin kontrol relay: input modul relay dihubungkan ke GPIO5 ESP32-S3.
#define RELAY_DEFAULT_GPIO GPIO_NUM_5

// Default logika aktif relay (aktif-high): level HIGH = relay ON.
#define RELAY_ACTIVE_LEVEL_HIGH 1U
#define RELAY_ACTIVE_LEVEL_LOW 0U

typedef struct {
	gpio_num_t gpio_num;
	uint8_t active_level;
	bool default_on;
} relay_config_t;

// Inisialisasi driver relay.
// Jika config bernilai NULL, gunakan default: GPIO5 aktif-high dan kondisi awal OFF.
esp_err_t relay_init(const relay_config_t *config);

// Melepas resource relay dan reset pin ke kondisi default.
esp_err_t relay_deinit(void);

// Mengatur status relay: true = ON, false = OFF.
esp_err_t relay_set(bool on);

// Shortcut menyalakan relay.
esp_err_t relay_on(void);

// Shortcut mematikan relay.
esp_err_t relay_off(void);

// Membalik status relay saat ini.
esp_err_t relay_toggle(void);

// Mengambil status logis relay (true = ON, false = OFF).
bool relay_get_state(void);

// Mengecek apakah driver relay sudah diinisialisasi.
bool relay_is_initialized(void);

#ifdef __cplusplus
}
#endif

#endif

