#ifndef TELEMETRY_H
#define TELEMETRY_H

#include <stddef.h>
#include <stdint.h>

#include "ascon.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Sampel minimum data listrik untuk monitoring dashboard.
typedef struct {
	float voltage_v;
	float current_a;
	float power_w;
	float energy_wh;
	float frequency_hz;
	float power_factor;
	uint16_t alarm_status;
	int64_t ts_ms;
} telemetry_power_sample_t;

// Struktur pesan command terenkripsi dari backend.
typedef struct {
	char command_id[32];
	uint8_t nonce[ASCON_NONCE_SIZE];
	uint8_t tag[ASCON_TAG_SIZE];
	uint8_t ciphertext[192];
	size_t ciphertext_len;
} telemetry_encrypted_command_t;

// Jumlah sampel per batch sebelum dikirim ke server (1 sampel/detik → kirim tiap 10 detik).
#define TELEMETRY_BATCH_SIZE 10U

// Bentuk payload telemetry plaintext JSON satu sampel (fallback/debug).
esp_err_t telemetry_build_power_json(
	const char *device_id,
	const telemetry_power_sample_t *sample,
	char *out_json,
	size_t out_json_len);

// Bentuk payload telemetry terenkripsi ASCON satu sampel.
esp_err_t telemetry_build_encrypted_power_json(
	ascon_ctx_t *ascon_ctx,
	const char *device_id,
	const telemetry_power_sample_t *sample,
	char *out_json,
	size_t out_json_len);

// Bentuk payload JSON berisi array beberapa sampel sekaligus (plaintext, untuk debug).
esp_err_t telemetry_build_power_json_batch(
	const char *device_id,
	const telemetry_power_sample_t *samples,
	size_t count,
	char *out_json,
	size_t out_json_len);

// Bentuk payload batch terenkripsi ASCON — dipakai saat kirim 10 sampel sekaligus ke server.
esp_err_t telemetry_build_encrypted_batch_json(
	ascon_ctx_t *ascon_ctx,
	const char *device_id,
	const telemetry_power_sample_t *samples,
	size_t count,
	char *out_json,
	size_t out_json_len);

// Parse payload JSON command terenkripsi dari broker.
esp_err_t telemetry_parse_encrypted_command(
	const uint8_t *payload,
	size_t payload_len,
	telemetry_encrypted_command_t *out_cmd);

// Decrypt command terenkripsi menjadi string perintah relay.
esp_err_t telemetry_decrypt_command(
	ascon_ctx_t *ascon_ctx,
	const telemetry_encrypted_command_t *enc_cmd,
	char *out_command,
	size_t out_command_len,
	uint32_t *out_key_id,
	uint64_t *out_counter);

#ifdef __cplusplus
}
#endif

#endif
