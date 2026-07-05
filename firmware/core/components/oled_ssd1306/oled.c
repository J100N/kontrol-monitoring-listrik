#include "oled.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"

/*
 * Referensi implementasi:
 * 1) Dokumentasi resmi ESP-IDF LCD API:
 *    https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/lcd/index.html
 * 2) Contoh resmi Espressif i2c_oled (SSD1306 + esp_lcd):
 *    https://github.com/espressif/esp-idf/tree/v5.3.1/examples/peripherals/lcd/i2c_oled
 * 3) SSD1306 datasheet (format control/cmd bits):
 *    https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf
 */

#define OLED_I2C_PORT I2C_NUM_0
#define OLED_I2C_CONTROL_PHASE_BYTES 1
#define OLED_LCD_CMD_BITS 8
#define OLED_LCD_PARAM_BITS 8

static const char *TAG = "oled_ssd1306";

#define OLED_TEXT_LINE_HEIGHT 8
#define OLED_TEXT_CHAR_WIDTH 6

// Konfigurasi default OLED mengikuti wiring proyek saat ini.
// Clock 100kHz (bukan 400kHz) lebih tahan terhadap kabel panjang / pull-up lemah
// sehingga mengurangi error I2C NACK. Untuk kestabilan penuh tetap disarankan
// pasang resistor pull-up eksternal 4.7k pada SDA & SCL.
static const oled_config_t OLED_DEFAULT_CONFIG = {
	.sda_gpio = OLED_DEFAULT_SDA_GPIO,
	.scl_gpio = OLED_DEFAULT_SCL_GPIO,
	.i2c_clk_hz = 100000,
	.i2c_addr = OLED_DEFAULT_I2C_ADDR,
	.width = OLED_DEFAULT_WIDTH,
	.height = OLED_DEFAULT_HEIGHT,
	.enable_internal_pullup = true,
};

// State internal komponen OLED.
static bool s_initialized = false;
static oled_config_t s_cfg;
static i2c_master_bus_handle_t s_i2c_bus = NULL;
static esp_lcd_panel_io_handle_t s_io_handle = NULL;
static esp_lcd_panel_handle_t s_panel_handle = NULL;
static uint8_t *s_framebuffer = NULL;
static size_t s_framebuffer_len = 0;

typedef struct {
	char ch;
	uint8_t col[5];
} oled_glyph_t;

// Font 5x7 sederhana untuk kebutuhan dashboard status.
static const oled_glyph_t OLED_GLYPHS[] = {
	{' ', {0x00, 0x00, 0x00, 0x00, 0x00}}, {'-', {0x08, 0x08, 0x08, 0x08, 0x08}},
	{'.', {0x00, 0x00, 0x00, 0x06, 0x06}}, {':', {0x00, 0x36, 0x36, 0x00, 0x00}},
	{'/', {0x03, 0x06, 0x0C, 0x18, 0x30}},
	{'0', {0x3E, 0x45, 0x49, 0x51, 0x3E}}, {'1', {0x00, 0x21, 0x7F, 0x01, 0x00}},
	{'2', {0x21, 0x43, 0x45, 0x49, 0x31}}, {'3', {0x42, 0x41, 0x51, 0x69, 0x46}},
	{'4', {0x0C, 0x14, 0x24, 0x7F, 0x04}}, {'5', {0x72, 0x51, 0x51, 0x51, 0x4E}},
	{'6', {0x1E, 0x29, 0x49, 0x49, 0x06}}, {'7', {0x40, 0x47, 0x48, 0x50, 0x60}},
	{'8', {0x36, 0x49, 0x49, 0x49, 0x36}}, {'9', {0x30, 0x49, 0x49, 0x4A, 0x3C}},
	{'A', {0x1F, 0x24, 0x44, 0x24, 0x1F}}, {'B', {0x7F, 0x49, 0x49, 0x49, 0x36}},
	{'C', {0x3E, 0x41, 0x41, 0x41, 0x22}}, {'D', {0x7F, 0x41, 0x41, 0x22, 0x1C}},
	{'E', {0x7F, 0x49, 0x49, 0x49, 0x41}}, {'F', {0x7F, 0x48, 0x48, 0x48, 0x40}},
	{'G', {0x3E, 0x41, 0x49, 0x49, 0x2E}}, {'H', {0x7F, 0x08, 0x08, 0x08, 0x7F}},
	{'I', {0x00, 0x41, 0x7F, 0x41, 0x00}}, {'J', {0x02, 0x01, 0x01, 0x01, 0x7E}},
	{'K', {0x7F, 0x08, 0x14, 0x22, 0x41}}, {'L', {0x7F, 0x01, 0x01, 0x01, 0x01}},
	{'M', {0x7F, 0x20, 0x10, 0x20, 0x7F}}, {'N', {0x7F, 0x10, 0x08, 0x04, 0x7F}},
	{'O', {0x3E, 0x41, 0x41, 0x41, 0x3E}}, {'P', {0x7F, 0x48, 0x48, 0x48, 0x30}},
	{'Q', {0x3E, 0x41, 0x45, 0x42, 0x3D}}, {'R', {0x7F, 0x48, 0x4C, 0x4A, 0x31}},
	{'S', {0x32, 0x49, 0x49, 0x49, 0x26}}, {'T', {0x40, 0x40, 0x7F, 0x40, 0x40}},
	{'U', {0x7E, 0x01, 0x01, 0x01, 0x7E}}, {'V', {0x7C, 0x02, 0x01, 0x02, 0x7C}},
	{'W', {0x7E, 0x01, 0x06, 0x01, 0x7E}}, {'X', {0x63, 0x14, 0x08, 0x14, 0x63}},
	{'Y', {0x70, 0x08, 0x07, 0x08, 0x70}}, {'Z', {0x43, 0x45, 0x49, 0x51, 0x61}},
	{'?', {0x20, 0x40, 0x4D, 0x50, 0x20}},
};

static void oled_fb_set_pixel(int x, int y, bool on)
{
	if (s_framebuffer == NULL || x < 0 || y < 0 || x >= (int)s_cfg.width || y >= (int)s_cfg.height) {
		return;
	}

	// SSD1306 page layout: 1 byte mewakili kolom vertikal 8 piksel.
	size_t index = (size_t)x + ((size_t)(y / 8) * (size_t)s_cfg.width);
	uint8_t mask = (uint8_t)(1U << (y % 8));
	if (on) {
		s_framebuffer[index] |= mask;
	} else {
		s_framebuffer[index] &= (uint8_t)(~mask);
	}
}

static const uint8_t *oled_find_glyph(char ch)
{
	if (ch >= 'a' && ch <= 'z') {
		ch = (char)toupper((unsigned char)ch);
	}

	for (size_t i = 0; i < (sizeof(OLED_GLYPHS) / sizeof(OLED_GLYPHS[0])); i++) {
		if (OLED_GLYPHS[i].ch == ch) {
			return OLED_GLYPHS[i].col;
		}
	}

	for (size_t i = 0; i < (sizeof(OLED_GLYPHS) / sizeof(OLED_GLYPHS[0])); i++) {
		if (OLED_GLYPHS[i].ch == '?') {
			return OLED_GLYPHS[i].col;
		}
	}

	return NULL;
}

static void oled_draw_char_5x7(int x, int y, char ch)
{
	const uint8_t *glyph = oled_find_glyph(ch);
	if (glyph == NULL) {
		return;
	}

	for (int col = 0; col < 5; col++) {
		for (int row = 0; row < 7; row++) {
			bool on = ((glyph[col] >> row) & 0x01U) != 0;
			oled_fb_set_pixel(x + col, y + row, on);
		}
	}
}

static void oled_draw_text_line(int y, const char *text)
{
	if (text == NULL) {
		return;
	}

	int max_chars = (int)s_cfg.width / OLED_TEXT_CHAR_WIDTH;
	for (int i = 0; text[i] != '\0' && i < max_chars; i++) {
		oled_draw_char_5x7(i * OLED_TEXT_CHAR_WIDTH, y, text[i]);
	}
}

bool oled_is_initialized(void)
{
	return s_initialized;
}

static esp_err_t oled_validate_config(const oled_config_t *cfg)
{
	ESP_RETURN_ON_FALSE(cfg != NULL, ESP_ERR_INVALID_ARG, TAG, "config null");
	ESP_RETURN_ON_FALSE(cfg->sda_gpio >= 0 && cfg->scl_gpio >= 0, ESP_ERR_INVALID_ARG, TAG, "pin i2c tidak valid");
	ESP_RETURN_ON_FALSE(cfg->i2c_clk_hz > 0, ESP_ERR_INVALID_ARG, TAG, "clock i2c tidak valid");
	ESP_RETURN_ON_FALSE(cfg->width > 0 && cfg->height > 0, ESP_ERR_INVALID_ARG, TAG, "resolusi tidak valid");
	ESP_RETURN_ON_FALSE((cfg->width % 8) == 0, ESP_ERR_INVALID_ARG, TAG, "lebar OLED harus kelipatan 8 untuk mode 1bpp");
	return ESP_OK;
}

esp_err_t oled_set_display_on(bool on)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "oled belum init");
	return esp_lcd_panel_disp_on_off(s_panel_handle, on);
}

esp_err_t oled_draw_buffer(const uint8_t *buffer, size_t len)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "oled belum init");
	ESP_RETURN_ON_FALSE(buffer != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer null");
	ESP_RETURN_ON_FALSE(len == s_framebuffer_len, ESP_ERR_INVALID_SIZE, TAG, "ukuran buffer tidak sesuai");

	// Kirim satu frame monochrome 1bpp penuh ke panel SSD1306.
	return esp_lcd_panel_draw_bitmap(s_panel_handle, 0, 0, s_cfg.width, s_cfg.height, buffer);
}

esp_err_t oled_draw_text_lines(const char *lines[], size_t line_count)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "oled belum init");
	ESP_RETURN_ON_FALSE(lines != NULL, ESP_ERR_INVALID_ARG, TAG, "lines null");

	memset(s_framebuffer, 0x00, s_framebuffer_len);

	size_t max_lines = s_cfg.height / OLED_TEXT_LINE_HEIGHT;
	if (line_count > max_lines) {
		line_count = max_lines;
	}

	for (size_t i = 0; i < line_count; i++) {
		oled_draw_text_line((int)(i * OLED_TEXT_LINE_HEIGHT), lines[i]);
	}

	return oled_draw_buffer(s_framebuffer, s_framebuffer_len);
}

esp_err_t oled_clear(void)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "oled belum init");

	memset(s_framebuffer, 0x00, s_framebuffer_len);
	return oled_draw_buffer(s_framebuffer, s_framebuffer_len);
}

esp_err_t oled_init(const oled_config_t *config)
{
	if (s_initialized) {
		ESP_LOGW(TAG, "oled sudah init, lewati init ulang");
		return ESP_OK;
	}

	s_cfg = (config != NULL) ? *config : OLED_DEFAULT_CONFIG;
	ESP_RETURN_ON_ERROR(oled_validate_config(&s_cfg), TAG, "config oled tidak valid");

	// Alokasi framebuffer internal untuk operasi clear/draw sederhana.
	s_framebuffer_len = ((size_t)s_cfg.width * (size_t)s_cfg.height) / 8;
	s_framebuffer = (uint8_t *)calloc(s_framebuffer_len, 1);
	ESP_RETURN_ON_FALSE(s_framebuffer != NULL, ESP_ERR_NO_MEM, TAG, "alokasi framebuffer gagal");

	// Inisialisasi I2C master bus.
	i2c_master_bus_config_t bus_cfg = {
		.clk_source = I2C_CLK_SRC_DEFAULT,
		.glitch_ignore_cnt = 7,
		.i2c_port = OLED_I2C_PORT,
		.sda_io_num = s_cfg.sda_gpio,
		.scl_io_num = s_cfg.scl_gpio,
		.flags.enable_internal_pullup = s_cfg.enable_internal_pullup,
	};
	esp_err_t ret = i2c_new_master_bus(&bus_cfg, &s_i2c_bus);
	if (ret != ESP_OK) {
		free(s_framebuffer);
		s_framebuffer = NULL;
		s_framebuffer_len = 0;
		return ret;
	}

	// Buat panel IO I2C untuk SSD1306.
	esp_lcd_panel_io_i2c_config_t io_cfg = {
		.dev_addr = s_cfg.i2c_addr,
		.scl_speed_hz = s_cfg.i2c_clk_hz,
		.control_phase_bytes = OLED_I2C_CONTROL_PHASE_BYTES,
		.lcd_cmd_bits = OLED_LCD_CMD_BITS,
		.lcd_param_bits = OLED_LCD_PARAM_BITS,
		.dc_bit_offset = 6,
	};
	ret = esp_lcd_new_panel_io_i2c(s_i2c_bus, &io_cfg, &s_io_handle);
	if (ret != ESP_OK) {
		i2c_del_master_bus(s_i2c_bus);
		s_i2c_bus = NULL;
		free(s_framebuffer);
		s_framebuffer = NULL;
		s_framebuffer_len = 0;
		return ret;
	}

	// Buat dan inisialisasi driver panel SSD1306.
	esp_lcd_panel_dev_config_t panel_cfg = {
		.bits_per_pixel = 1,
		.reset_gpio_num = -1,
	};
	esp_lcd_panel_ssd1306_config_t ssd1306_cfg = {
		.height = s_cfg.height,
	};
	panel_cfg.vendor_config = &ssd1306_cfg;

	ret = esp_lcd_new_panel_ssd1306(s_io_handle, &panel_cfg, &s_panel_handle);
	if (ret != ESP_OK) {
		esp_lcd_panel_io_del(s_io_handle);
		s_io_handle = NULL;
		i2c_del_master_bus(s_i2c_bus);
		s_i2c_bus = NULL;
		free(s_framebuffer);
		s_framebuffer = NULL;
		s_framebuffer_len = 0;
		return ret;
	}

	ESP_GOTO_ON_ERROR(esp_lcd_panel_reset(s_panel_handle), err, TAG, "panel reset gagal");
	ESP_GOTO_ON_ERROR(esp_lcd_panel_init(s_panel_handle), err, TAG, "panel init gagal");
	ESP_GOTO_ON_ERROR(esp_lcd_panel_swap_xy(s_panel_handle, false), err, TAG, "set swap_xy gagal");
	ESP_GOTO_ON_ERROR(esp_lcd_panel_mirror(s_panel_handle, true, false), err, TAG, "set mirror gagal");
	ESP_GOTO_ON_ERROR(esp_lcd_panel_disp_on_off(s_panel_handle, true), err, TAG, "display on gagal");
	s_initialized = true;
	ESP_GOTO_ON_ERROR(oled_clear(), err, TAG, "clear awal gagal");

	ESP_LOGI(
		TAG,
		"oled init ok (SDA=%d SCL=%d addr=0x%02X %ux%u)",
		s_cfg.sda_gpio,
		s_cfg.scl_gpio,
		s_cfg.i2c_addr,
		s_cfg.width,
		s_cfg.height);

	return ESP_OK;

err:
	if (s_panel_handle) {
		esp_lcd_panel_del(s_panel_handle);
		s_panel_handle = NULL;
	}
	if (s_io_handle) {
		esp_lcd_panel_io_del(s_io_handle);
		s_io_handle = NULL;
	}
	if (s_i2c_bus) {
		i2c_del_master_bus(s_i2c_bus);
		s_i2c_bus = NULL;
	}
	if (s_framebuffer) {
		free(s_framebuffer);
		s_framebuffer = NULL;
		s_framebuffer_len = 0;
	}
	s_initialized = false;
	return ret;
}

esp_err_t oled_deinit(void)
{
	if (!s_initialized && !s_panel_handle && !s_io_handle && !s_i2c_bus) {
		return ESP_OK;
	}

	if (s_panel_handle) {
		esp_lcd_panel_disp_on_off(s_panel_handle, false);
		esp_lcd_panel_del(s_panel_handle);
		s_panel_handle = NULL;
	}
	if (s_io_handle) {
		esp_lcd_panel_io_del(s_io_handle);
		s_io_handle = NULL;
	}
	if (s_i2c_bus) {
		i2c_del_master_bus(s_i2c_bus);
		s_i2c_bus = NULL;
	}
	if (s_framebuffer) {
		free(s_framebuffer);
		s_framebuffer = NULL;
		s_framebuffer_len = 0;
	}

	memset(&s_cfg, 0, sizeof(s_cfg));
	s_initialized = false;
	return ESP_OK;
}

