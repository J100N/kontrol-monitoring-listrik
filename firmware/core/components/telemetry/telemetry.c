#include "telemetry.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_check.h"

/* Ukuran buffer teks JSON.
 * - 1 sampel  : ~100 karakter  -> buffer 256 sudah cukup.
 * - 10 sampel : ~100 x 10 + header/footer ~45 = ~1045 karakter (kasus terburuk).
 *   Buffer 1280 memberi margin aman supaya batch 10 sampel tidak terpotong. */
#define TELEMETRY_PLAIN_BUF_MAX       256
#define TELEMETRY_BATCH_PLAIN_BUF_MAX 1280

static const char *TAG = "telemetry";

/* =============================================================
 * ALAT BANTU: UBAH ANTARA HEX DAN BYTE, BACA ISI JSON
 * ============================================================= */

static int hex_nibble(char c)
{
	if (c >= '0' && c <= '9') {
		return c - '0';
	}
	c = (char)tolower((unsigned char)c);
	if (c >= 'a' && c <= 'f') {
		return 10 + (c - 'a');
	}
	return -1;
}

static esp_err_t hex_to_bytes(const char *hex, uint8_t *out, size_t out_len)
{
	ESP_RETURN_ON_FALSE(hex != NULL && out != NULL, ESP_ERR_INVALID_ARG, TAG, "arg hex null");

	size_t hex_len = strlen(hex);
	ESP_RETURN_ON_FALSE((hex_len % 2U) == 0U, ESP_ERR_INVALID_ARG, TAG, "panjang hex harus genap");
	ESP_RETURN_ON_FALSE((hex_len / 2U) <= out_len, ESP_ERR_INVALID_SIZE, TAG, "buffer output kecil");

	for (size_t i = 0; i < (hex_len / 2U); i++) {
		int hi = hex_nibble(hex[i * 2U]);
		int lo = hex_nibble(hex[i * 2U + 1U]);
		ESP_RETURN_ON_FALSE(hi >= 0 && lo >= 0, ESP_ERR_INVALID_ARG, TAG, "hex tidak valid");
		out[i] = (uint8_t)((hi << 4) | lo);
	}

	return ESP_OK;
}

static void bytes_to_hex(const uint8_t *in, size_t in_len, char *out_hex, size_t out_hex_len)
{
	static const char HEX[] = "0123456789abcdef";
	if (in == NULL || out_hex == NULL || out_hex_len < ((in_len * 2U) + 1U)) {
		return;
	}

	for (size_t i = 0; i < in_len; i++) {
		out_hex[i * 2U] = HEX[(in[i] >> 4) & 0x0FU];
		out_hex[i * 2U + 1U] = HEX[in[i] & 0x0FU];
	}
	out_hex[in_len * 2U] = '\0';
}

static esp_err_t extract_json_string(const char *json, const char *key, char *out, size_t out_len)
{
	ESP_RETURN_ON_FALSE(json != NULL && key != NULL && out != NULL, ESP_ERR_INVALID_ARG, TAG, "arg extract null");

	char pattern[40] = {0};
	int n = snprintf(pattern, sizeof(pattern), "\"%s\":\"", key);
	ESP_RETURN_ON_FALSE(n > 0 && n < (int)sizeof(pattern), ESP_ERR_INVALID_SIZE, TAG, "pattern terlalu panjang");

	const char *p = strstr(json, pattern);
	ESP_RETURN_ON_FALSE(p != NULL, ESP_ERR_NOT_FOUND, TAG, "key tidak ditemukan");
	p += strlen(pattern);

	const char *end = strchr(p, '"');
	ESP_RETURN_ON_FALSE(end != NULL, ESP_ERR_INVALID_RESPONSE, TAG, "format json invalid");

	size_t len = (size_t)(end - p);
	ESP_RETURN_ON_FALSE(len < out_len, ESP_ERR_INVALID_SIZE, TAG, "buffer output kecil");
	memcpy(out, p, len);
	out[len] = '\0';

	return ESP_OK;
}

/* =============================================================
 * BENTUK DATA 1 SAMPEL (HANYA UNTUK DEBUG / CADANGAN)
 * Alur utama sistem memakai versi BATCH di bawah, bukan ini.
 * ============================================================= */

esp_err_t telemetry_build_power_json(
	const char *device_id,
	const telemetry_power_sample_t *sample,
	char *out_json,
	size_t out_json_len)
{
	ESP_RETURN_ON_FALSE(device_id != NULL && sample != NULL && out_json != NULL, ESP_ERR_INVALID_ARG, TAG, "arg telemetry null");

	int n = snprintf(
		out_json,
		out_json_len,
		"{\"device_id\":\"%s\",\"ts\":%lld,\"voltage_v\":%.1f,\"current_a\":%.3f,\"power_w\":%.1f,\"energy_wh\":%.0f}",
		device_id,
		(long long)sample->ts_ms,
		sample->voltage_v,
		sample->current_a,
		sample->power_w,
		sample->energy_wh);

	ESP_RETURN_ON_FALSE(n > 0 && n < (int)out_json_len, ESP_ERR_INVALID_SIZE, TAG, "buffer json telemetry kecil");
	return ESP_OK;
}

esp_err_t telemetry_build_encrypted_power_json(
	ascon_ctx_t *ascon_ctx,
	const char *device_id,
	const telemetry_power_sample_t *sample,
	char *out_json,
	size_t out_json_len)
{
	ESP_RETURN_ON_FALSE(ascon_ctx != NULL, ESP_ERR_INVALID_ARG, TAG, "ctx ascon null");
	ESP_RETURN_ON_FALSE(device_id != NULL && sample != NULL && out_json != NULL, ESP_ERR_INVALID_ARG, TAG, "arg telemetry null");

	char plain[TELEMETRY_PLAIN_BUF_MAX] = {0};
	ESP_RETURN_ON_ERROR(telemetry_build_power_json(device_id, sample, plain, sizeof(plain)), TAG, "build plain telemetry gagal");

	size_t plain_len = strlen(plain);
	uint8_t nonce[ASCON_NONCE_SIZE] = {0};
	uint8_t tag[ASCON_TAG_SIZE] = {0};
	uint8_t cipher[TELEMETRY_PLAIN_BUF_MAX] = {0};
	uint32_t key_id = 0;
	uint64_t counter = 0;

	ESP_RETURN_ON_ERROR(
		ascon_encrypt_telemetry(
			ascon_ctx,
			(const uint8_t *)device_id,
			strlen(device_id),
			(const uint8_t *)plain,
			plain_len,
			nonce,
			cipher,
			tag,
			&key_id,
			&counter),
		TAG,
		"encrypt telemetry gagal");

	char nonce_hex[(ASCON_NONCE_SIZE * 2U) + 1U] = {0};
	char tag_hex[(ASCON_TAG_SIZE * 2U) + 1U] = {0};
	char cipher_hex[(TELEMETRY_PLAIN_BUF_MAX * 2U) + 1U] = {0};
	bytes_to_hex(nonce, sizeof(nonce), nonce_hex, sizeof(nonce_hex));
	bytes_to_hex(tag, sizeof(tag), tag_hex, sizeof(tag_hex));
	bytes_to_hex(cipher, plain_len, cipher_hex, sizeof(cipher_hex));

	int n = snprintf(
		out_json,
		out_json_len,
		"{\"enc\":1,\"device_id\":\"%s\",\"kid\":%lu,\"ctr\":%llu,\"nonce\":\"%s\",\"tag\":\"%s\",\"cipher\":\"%s\"}",
		device_id,
		(unsigned long)key_id,
		(unsigned long long)counter,
		nonce_hex,
		tag_hex,
		cipher_hex);

	ESP_RETURN_ON_FALSE(n > 0 && n < (int)out_json_len, ESP_ERR_INVALID_SIZE, TAG, "buffer telemetry encrypted kecil");
	return ESP_OK;
}

/* =============================================================
 * BENTUK DATA BATCH 10 SAMPEL (DIPAKAI DI ALUR UTAMA)
 * 10 sampel (1 sampel/detik) dikumpulkan, lalu dikirim sekaligus
 * setiap 10 detik untuk menghemat koneksi.
 * ============================================================= */

/* Buffer statik untuk fungsi batch — ditempatkan di BSS agar tidak membebani stack. */
static char     s_batch_plain[TELEMETRY_BATCH_PLAIN_BUF_MAX];
static uint8_t  s_batch_cipher[TELEMETRY_BATCH_PLAIN_BUF_MAX];
static char     s_batch_cipher_hex[(TELEMETRY_BATCH_PLAIN_BUF_MAX * 2U) + 1U];

esp_err_t telemetry_build_power_json_batch(
	const char *device_id,
	const telemetry_power_sample_t *samples,
	size_t count,
	char *out_json,
	size_t out_json_len)
{
	ESP_RETURN_ON_FALSE(device_id != NULL && samples != NULL && out_json != NULL, ESP_ERR_INVALID_ARG, TAG, "arg batch null");
	ESP_RETURN_ON_FALSE(count > 0U, ESP_ERR_INVALID_ARG, TAG, "count harus > 0");

	/* Kunci JSON pendek dipakai agar ukuran payload tidak terlalu besar:
	   v=voltage, i=current, p=power, e=energy, f=frequency, pf=power_factor */
	int pos = snprintf(out_json, out_json_len, "{\"device_id\":\"%s\",\"samples\":[", device_id);
	ESP_RETURN_ON_FALSE(pos > 0 && (size_t)pos < out_json_len, ESP_ERR_INVALID_SIZE, TAG, "buffer batch kecil (header)");

	for (size_t k = 0; k < count; k++) {
		const telemetry_power_sample_t *s = &samples[k];
		int n = snprintf(
			out_json + pos,
			out_json_len - (size_t)pos,
			"%s{\"ts\":%lld,\"v\":%.1f,\"i\":%.3f,\"p\":%.1f,\"e\":%.0f,\"f\":%.1f,\"pf\":%.2f,\"alarm\":%u}",
			(k > 0U) ? "," : "",
			(long long)s->ts_ms,
			s->voltage_v,
			s->current_a,
			s->power_w,
			s->energy_wh,
			s->frequency_hz,
			s->power_factor,
			(unsigned)s->alarm_status);
		ESP_RETURN_ON_FALSE(n > 0 && (size_t)(pos + n) < out_json_len, ESP_ERR_INVALID_SIZE, TAG, "buffer batch kecil (sampel)");
		pos += n;
	}

	int n = snprintf(out_json + pos, out_json_len - (size_t)pos, "]}");
	ESP_RETURN_ON_FALSE(n > 0 && (size_t)(pos + n) < out_json_len, ESP_ERR_INVALID_SIZE, TAG, "buffer batch kecil (footer)");

	return ESP_OK;
}

esp_err_t telemetry_build_encrypted_batch_json(
	ascon_ctx_t *ascon_ctx,
	const char *device_id,
	const telemetry_power_sample_t *samples,
	size_t count,
	char *out_json,
	size_t out_json_len)
{
	ESP_RETURN_ON_FALSE(ascon_ctx != NULL, ESP_ERR_INVALID_ARG, TAG, "ctx ascon null");
	ESP_RETURN_ON_FALSE(device_id != NULL && samples != NULL && out_json != NULL, ESP_ERR_INVALID_ARG, TAG, "arg batch enc null");

	ESP_RETURN_ON_ERROR(
		telemetry_build_power_json_batch(device_id, samples, count, s_batch_plain, sizeof(s_batch_plain)),
		TAG, "build plain batch gagal");

	size_t plain_len = strlen(s_batch_plain);
	uint8_t nonce[ASCON_NONCE_SIZE] = {0};
	uint8_t tag[ASCON_TAG_SIZE]     = {0};
	uint32_t key_id  = 0;
	uint64_t counter = 0;

	ESP_RETURN_ON_ERROR(
		ascon_encrypt_telemetry(
			ascon_ctx,
			(const uint8_t *)device_id,
			strlen(device_id),
			(const uint8_t *)s_batch_plain,
			plain_len,
			nonce,
			s_batch_cipher,
			tag,
			&key_id,
			&counter),
		TAG, "encrypt batch gagal");

	char nonce_hex[(ASCON_NONCE_SIZE * 2U) + 1U] = {0};
	char tag_hex[(ASCON_TAG_SIZE   * 2U) + 1U] = {0};
	bytes_to_hex(nonce,         sizeof(nonce), nonce_hex, sizeof(nonce_hex));
	bytes_to_hex(tag,           sizeof(tag),   tag_hex,   sizeof(tag_hex));
	bytes_to_hex(s_batch_cipher, plain_len,    s_batch_cipher_hex, sizeof(s_batch_cipher_hex));

	int n = snprintf(
		out_json,
		out_json_len,
		"{\"enc\":1,\"device_id\":\"%s\",\"kid\":%lu,\"ctr\":%llu,\"nonce\":\"%s\",\"tag\":\"%s\",\"cipher\":\"%s\"}",
		device_id,
		(unsigned long)key_id,
		(unsigned long long)counter,
		nonce_hex,
		tag_hex,
		s_batch_cipher_hex);

	ESP_RETURN_ON_FALSE(n > 0 && n < (int)out_json_len, ESP_ERR_INVALID_SIZE, TAG, "buffer output batch enc kecil");
	return ESP_OK;
}

/* =============================================================
 * TERIMA & BUKA PERINTAH TERENKRIPSI DARI SERVER
 * (server -> device, mis. perintah relay_on / relay_off)
 * ============================================================= */

esp_err_t telemetry_parse_encrypted_command(
	const uint8_t *payload,
	size_t payload_len,
	telemetry_encrypted_command_t *out_cmd)
{
	ESP_RETURN_ON_FALSE(payload != NULL && out_cmd != NULL, ESP_ERR_INVALID_ARG, TAG, "arg parse null");
	ESP_RETURN_ON_FALSE(payload_len > 0U, ESP_ERR_INVALID_ARG, TAG, "payload kosong");

	memset(out_cmd, 0, sizeof(*out_cmd));

	char json[512] = {0};
	size_t ncopy = (payload_len < (sizeof(json) - 1U)) ? payload_len : (sizeof(json) - 1U);
	memcpy(json, payload, ncopy);

	char nonce_hex[(ASCON_NONCE_SIZE * 2U) + 1U] = {0};
	char tag_hex[(ASCON_TAG_SIZE * 2U) + 1U] = {0};
	char cipher_hex[(sizeof(out_cmd->ciphertext) * 2U) + 1U] = {0};

	// Wajib format encrypted baru: enc=1 serta field kid/ctr harus ada.
	ESP_RETURN_ON_FALSE(strstr(json, "\"enc\":1") != NULL, ESP_ERR_INVALID_ARG, TAG, "field enc wajib bernilai 1");
	ESP_RETURN_ON_FALSE(strstr(json, "\"kid\":") != NULL, ESP_ERR_INVALID_ARG, TAG, "field kid wajib ada");
	ESP_RETURN_ON_FALSE(strstr(json, "\"ctr\":") != NULL, ESP_ERR_INVALID_ARG, TAG, "field ctr wajib ada");

	if (extract_json_string(json, "nonce", nonce_hex, sizeof(nonce_hex)) != ESP_OK ||
		extract_json_string(json, "tag", tag_hex, sizeof(tag_hex)) != ESP_OK ||
		extract_json_string(json, "cipher", cipher_hex, sizeof(cipher_hex)) != ESP_OK) {
		return ESP_ERR_NOT_FOUND;
	}

	ESP_RETURN_ON_ERROR(
		extract_json_string(json, "command_id", out_cmd->command_id, sizeof(out_cmd->command_id)),
		TAG,
		"field command_id wajib ada");

	ESP_RETURN_ON_ERROR(hex_to_bytes(nonce_hex, out_cmd->nonce, sizeof(out_cmd->nonce)), TAG, "nonce hex invalid");
	ESP_RETURN_ON_ERROR(hex_to_bytes(tag_hex, out_cmd->tag, sizeof(out_cmd->tag)), TAG, "tag hex invalid");
	ESP_RETURN_ON_ERROR(hex_to_bytes(cipher_hex, out_cmd->ciphertext, sizeof(out_cmd->ciphertext)), TAG, "cipher hex invalid");
	out_cmd->ciphertext_len = strlen(cipher_hex) / 2U;

	return ESP_OK;
}

esp_err_t telemetry_decrypt_command(
	ascon_ctx_t *ascon_ctx,
	const telemetry_encrypted_command_t *enc_cmd,
	char *out_command,
	size_t out_command_len,
	uint32_t *out_key_id,
	uint64_t *out_counter)
{
	ESP_RETURN_ON_FALSE(
		ascon_ctx != NULL && enc_cmd != NULL && out_command != NULL,
		ESP_ERR_INVALID_ARG,
		TAG,
		"arg decrypt command null");

	memset(out_command, 0, out_command_len);
	ESP_RETURN_ON_ERROR(
		ascon_decrypt_command(
			ascon_ctx,
			enc_cmd->nonce,
			NULL,
			0,
			enc_cmd->ciphertext,
			enc_cmd->ciphertext_len,
			enc_cmd->tag,
			(uint8_t *)out_command,
			out_key_id,
			out_counter),
		TAG,
		"decrypt command gagal");

	out_command[out_command_len - 1U] = '\0';
	return ESP_OK;
}
