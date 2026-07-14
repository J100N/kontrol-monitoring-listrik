#ifndef OLED_H
#define OLED_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Default pin I2C sesuai wiring yang diminta.
#define OLED_DEFAULT_SDA_GPIO 9
#define OLED_DEFAULT_SCL_GPIO 10

// Konfigurasi umum SSD1306 128x64 via I2C.
#define OLED_DEFAULT_WIDTH 128
#define OLED_DEFAULT_HEIGHT 64
#define OLED_DEFAULT_I2C_ADDR 0x3C

typedef struct {
	int sda_gpio;
	int scl_gpio;
	uint32_t i2c_clk_hz;
	uint8_t i2c_addr;
	uint16_t width;
	uint16_t height;
	bool enable_internal_pullup;
} oled_config_t;

// Inisialisasi OLED SSD1306.
// Jika config NULL, akan memakai konfigurasi default komponen.
esp_err_t oled_init(const oled_config_t *config);

// Menonaktifkan driver OLED dan membebaskan resource I2C/panel.
esp_err_t oled_deinit(void);

// Membersihkan layar (isi semua piksel dengan warna hitam).
esp_err_t oled_clear(void);

// Menggambar buffer 1bpp penuh ke layar.
// Panjang buffer harus width * height / 8 byte.
esp_err_t oled_draw_buffer(const uint8_t *buffer, size_t len);

// Menggambar teks status multi-baris (maks 8 baris) dengan font 5x7 sederhana.
// Tiap baris dipotong otomatis agar muat pada layar.
esp_err_t oled_draw_text_lines(const char *lines[], size_t line_count);

// Mengatur status layar ON/OFF.
esp_err_t oled_set_display_on(bool on);

// Mengecek apakah komponen OLED sudah aktif.
bool oled_is_initialized(void);

#ifdef __cplusplus
}
#endif

#endif

