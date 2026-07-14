#ifndef ASCON_H
#define ASCON_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Implementasi Ascon-AEAD128 sesuai NIST SP 800-232 (final 13 Agustus 2025).
 * Parameter: k=128, n=128, t=128, rate=128 bit, rounds 12/8 (pa/pb).
 *
 * Migrasi dari ASCON-128 v1.2 (Round 3 NIST LWC finalist) ke standar resmi
 * SP 800-232 yang telah diadopsi NIST sebagai SP federal AS untuk
 * lightweight cryptography pada perangkat IoT.
 *
 * Algoritma di backend (asconAead128.js) dan firmware (ascon.c) menggunakan
 * spesifikasi yang SAMA — diverifikasi 1089/1089 KAT NIST resmi.
 *
 * Referensi:
 * 1) NIST SP 800-232 — https://csrc.nist.gov/pubs/sp/800/232/final
 * 2) Reference impl  — https://github.com/ascon/ascon-c (asconaead128)
 * 3) Situs author    — https://ascon.iaik.tugraz.at/
 *
 * Catatan: API tingkat aplikasi (context management, key rotation, replay
 * protection, nonce generation) tidak berubah dari versi sebelumnya — yang
 * berganti hanya algoritma kriptografi di bawahnya.
 */

#define ASCON_KEY_SIZE 16
#define ASCON_NONCE_SIZE 16
#define ASCON_TAG_SIZE 16

typedef struct {
	uint8_t active_key[ASCON_KEY_SIZE];
	uint8_t previous_key[ASCON_KEY_SIZE];
	uint32_t active_key_id;
	uint32_t previous_key_id;
	bool has_previous_key;

	// Prefix nonce per device/session (64-bit) + counter (64-bit).
	uint64_t nonce_prefix;
	uint64_t tx_counter;

	// Counter RX terakhir yang diterima valid untuk replay protection.
	uint64_t last_rx_counter;

	bool initialized;
} ascon_ctx_t;

// Inisialisasi konteks ASCON dengan active key awal.
esp_err_t ascon_init(ascon_ctx_t *ctx, const uint8_t key[ASCON_KEY_SIZE], uint32_t key_id);

// Hapus semua material kunci dari memori (secure wipe sederhana).
esp_err_t ascon_deinit(ascon_ctx_t *ctx);

// Rotasi key: active key lama dipindah menjadi previous key.
esp_err_t ascon_rotate_key(ascon_ctx_t *ctx, const uint8_t new_key[ASCON_KEY_SIZE], uint32_t new_key_id);

// Set/get counter TX bila ingin sinkron dengan NVS atau backend.
esp_err_t ascon_set_tx_counter(ascon_ctx_t *ctx, uint64_t value);
uint64_t ascon_get_tx_counter(const ascon_ctx_t *ctx);

// Set/get counter RX terakhir untuk replay protection (mis. restore dari NVS).
esp_err_t ascon_set_last_rx_counter(ascon_ctx_t *ctx, uint64_t value);
uint64_t ascon_get_last_rx_counter(const ascon_ctx_t *ctx);

// Set nonce prefix tetap (opsional) jika Anda punya device id 64-bit sendiri.
esp_err_t ascon_set_nonce_prefix(ascon_ctx_t *ctx, uint64_t prefix);

// Generate nonce unik: 8 byte prefix + 8 byte counter TX (big-endian).
esp_err_t ascon_generate_nonce(ascon_ctx_t *ctx, uint8_t out_nonce[ASCON_NONCE_SIZE], uint64_t *out_counter);

// Ambil counter dari nonce (format nonce harus sesuai generator di atas).
uint64_t ascon_counter_from_nonce(const uint8_t nonce[ASCON_NONCE_SIZE]);

// Validasi apakah counter masih fresh terhadap last_rx_counter.
bool ascon_is_fresh_counter(const ascon_ctx_t *ctx, uint64_t counter);

// Update replay window setelah paket terverifikasi valid.
esp_err_t ascon_update_rx_counter(ascon_ctx_t *ctx, uint64_t counter);

// AEAD encrypt/decrypt level dasar.
esp_err_t ascon_aead_encrypt(
	const ascon_ctx_t *ctx,
	const uint8_t nonce[ASCON_NONCE_SIZE],
	const uint8_t *aad,
	size_t aad_len,
	const uint8_t *plaintext,
	size_t plaintext_len,
	uint8_t *ciphertext,
	uint8_t tag[ASCON_TAG_SIZE]);

esp_err_t ascon_aead_decrypt(
	const ascon_ctx_t *ctx,
	const uint8_t nonce[ASCON_NONCE_SIZE],
	const uint8_t *aad,
	size_t aad_len,
	const uint8_t *ciphertext,
	size_t ciphertext_len,
	const uint8_t tag[ASCON_TAG_SIZE],
	uint8_t *plaintext,
	uint32_t *out_key_id);

// Helper untuk use-case telemetry: generate nonce + encrypt dalam satu panggilan.
esp_err_t ascon_encrypt_telemetry(
	ascon_ctx_t *ctx,
	const uint8_t *aad,
	size_t aad_len,
	const uint8_t *telemetry,
	size_t telemetry_len,
	uint8_t out_nonce[ASCON_NONCE_SIZE],
	uint8_t *out_ciphertext,
	uint8_t out_tag[ASCON_TAG_SIZE],
	uint32_t *out_key_id,
	uint64_t *out_counter);

// Helper untuk use-case command: replay check + decrypt + tag validation.
esp_err_t ascon_decrypt_command(
	ascon_ctx_t *ctx,
	const uint8_t nonce[ASCON_NONCE_SIZE],
	const uint8_t *aad,
	size_t aad_len,
	const uint8_t *ciphertext,
	size_t ciphertext_len,
	const uint8_t tag[ASCON_TAG_SIZE],
	uint8_t *out_plaintext,
	uint32_t *out_key_id,
	uint64_t *out_counter);

// Fungsi validasi tag konstan-waktu (untuk kebutuhan manual/testing).
bool ascon_validate_tag_ct(const uint8_t expected[ASCON_TAG_SIZE], const uint8_t received[ASCON_TAG_SIZE]);

#ifdef __cplusplus
}
#endif

#endif
