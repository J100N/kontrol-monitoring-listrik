#include "ascon.h"

#include <string.h>

#include "esp_check.h"
#include "esp_log.h"
#include "esp_random.h"

// =============================================================================
// Implementasi Ascon-AEAD128 sesuai NIST SP 800-232 (final, 13 Agustus 2025).
//
// Referensi resmi:
//   1) NIST SP 800-232 — https://csrc.nist.gov/pubs/sp/800/232/final
//   2) Implementasi referensi IAIK — https://github.com/ascon/ascon-c
//      (folder crypto_aead/asconaead128/ref)
//   3) Situs author Ascon — https://ascon.iaik.tugraz.at/
//
// Verifikasi: implementasi backend Node.js (asconAead128.js) yang berbagi
// algoritma sama persis dengan file ini sudah PASS 1089/1089 vektor KAT NIST
// resmi (LWC_AEAD_KAT_128_128.txt).
// =============================================================================

// IV Ascon-AEAD128 dihitung dari parameter (SP 800-232 §3.2):
//   variant=1 (AEAD), pa=12, pb=8, tag_bits=128, rate=16 byte
// Layout (little-endian byte order):
//   byte 0 = variant (0x01)
//   byte 2 = pa | (pb << 4) = 0x0C | 0x80 = 0x8C
//   byte 3 = tag_bits / 1 = 0x80
//   byte 5 = rate = 0x10
//   byte lain = 0x00
#define ASCON_AEAD128_IV                  \
	(((uint64_t)1U   << 0)  |             \
	 ((uint64_t)12U  << 16) |             \
	 ((uint64_t)8U   << 20) |             \
	 ((uint64_t)128U << 24) |             \
	 ((uint64_t)16U  << 40))

#define ASCON_PA_ROUNDS 12
#define ASCON_PB_ROUNDS 8
#define ASCON_AEAD_RATE 16

// Domain separation: bit MSB (0x80) di byte ke-7 dari x[4].
// Dalam encoding LE word 64-bit: 0x80 << 56 = 0x8000000000000000.
#define ASCON_DSEP ((uint64_t)0x80U << 56)

// Nilai sentinel untuk replay window yang belum pernah menerima paket.
#define ASCON_RX_COUNTER_UNSET UINT64_MAX

static const char *TAG = "ascon_crypto";

// State Ascon: array 5 word 64-bit (sesuai notasi spec NIST x[0]..x[4]).
typedef struct {
	uint64_t x[5];
} ascon_state_t;

// Round constants p[12] — sama untuk semua varian Ascon (v1.2 maupun SP 800-232).
static const uint8_t ASCON_RC[12] = {
	0xF0, 0xE1, 0xD2, 0xC3, 0xB4, 0xA5,
	0x96, 0x87, 0x78, 0x69, 0x5A, 0x4B,
};

// Rotasi kanan 64-bit (untuk linear diffusion layer).
static inline uint64_t ascon_rotr64(uint64_t x, uint32_t n)
{
	return (x >> n) | (x << (64U - n));
}

// Load n byte (n=0..8) menjadi word 64-bit LITTLE-ENDIAN.
// byte[0] → bit 0-7 (LSB), byte[i] → bit (8*i)..(8*i+7).
static uint64_t ascon_loadbytes(const uint8_t *bytes, size_t n)
{
	uint64_t x = 0U;
	for (size_t i = 0; i < n; i++) {
		x |= ((uint64_t)bytes[i]) << (8U * i);
	}
	return x;
}

// Store n byte (n=0..8) dari word 64-bit dalam urutan LITTLE-ENDIAN.
static void ascon_storebytes(uint8_t *bytes, uint64_t x, size_t n)
{
	for (size_t i = 0; i < n; i++) {
		bytes[i] = (uint8_t)((x >> (8U * i)) & 0xFFU);
	}
}

// Padding byte 0x01 di posisi byte ke-i (LE encoding).
static inline uint64_t ascon_pad(size_t i)
{
	return ((uint64_t)0x01U) << (8U * i);
}

// Nolkan n byte pertama (byte 0..n-1), mempertahankan byte n..7.
// Setara CLEARBYTES(x, n) di referensi C IAIK.
static uint64_t ascon_clear_first_n(uint64_t x, size_t n)
{
	for (size_t i = 0; i < n; i++) {
		x &= ~(((uint64_t)0xFFU) << (8U * i));
	}
	return x;
}

// Zero-out buffer sebelum dibebaskan (mengurangi risiko key residue di memori).
static void ascon_secure_zero(void *ptr, size_t len)
{
	volatile uint8_t *p = (volatile uint8_t *)ptr;
	while (len--) {
		*p++ = 0;
	}
}

// Permutasi Ascon p[r]
// r=12 untuk init/finalize, r=8 untuk per-blok rate 
static void ascon_permute(ascon_state_t *s, int rounds)
{
	int start = 12 - rounds;

	for (int i = start; i < 12; i++) {
		// (1) Penambahan round constant ke x[2]
		s->x[2] ^= (uint64_t)ASCON_RC[i];

		// (2) Substitution layer (S-box 5-bit Ascon)
		s->x[0] ^= s->x[4];
		s->x[4] ^= s->x[3];
		s->x[2] ^= s->x[1];

		uint64_t t0 = (~s->x[0]) & s->x[1];
		uint64_t t1 = (~s->x[1]) & s->x[2];
		uint64_t t2 = (~s->x[2]) & s->x[3];
		uint64_t t3 = (~s->x[3]) & s->x[4];
		uint64_t t4 = (~s->x[4]) & s->x[0];

		s->x[0] ^= t1;
		s->x[1] ^= t2;
		s->x[2] ^= t3;
		s->x[3] ^= t4;
		s->x[4] ^= t0;

		s->x[1] ^= s->x[0];
		s->x[0] ^= s->x[4];
		s->x[3] ^= s->x[2];
		s->x[2] = ~s->x[2];

		// (3) Linear diffusion layer (rotasi per word)
		s->x[0] ^= ascon_rotr64(s->x[0], 19) ^ ascon_rotr64(s->x[0], 28);
		s->x[1] ^= ascon_rotr64(s->x[1], 61) ^ ascon_rotr64(s->x[1], 39);
		s->x[2] ^= ascon_rotr64(s->x[2], 1)  ^ ascon_rotr64(s->x[2], 6);
		s->x[3] ^= ascon_rotr64(s->x[3], 10) ^ ascon_rotr64(s->x[3], 17);
		s->x[4] ^= ascon_rotr64(s->x[4], 7)  ^ ascon_rotr64(s->x[4], 41);
	}
}

// Init: load IV+key+nonce → P12 → XOR kunci kembali ke x[3], x[4].
static void ascon_aead_init(ascon_state_t *s, const uint8_t key[ASCON_KEY_SIZE], const uint8_t nonce[ASCON_NONCE_SIZE])
{
	uint64_t k0 = ascon_loadbytes(key, 8);
	uint64_t k1 = ascon_loadbytes(key + 8, 8);
	uint64_t n0 = ascon_loadbytes(nonce, 8);
	uint64_t n1 = ascon_loadbytes(nonce + 8, 8);

	s->x[0] = ASCON_AEAD128_IV;
	s->x[1] = k0;
	s->x[2] = k1;
	s->x[3] = n0;
	s->x[4] = n1;

	ascon_permute(s, ASCON_PA_ROUNDS);

	s->x[3] ^= k0;
	s->x[4] ^= k1;
}

// Absorb Associated Data — kalau aad_len=0, lewati blok AD; tetap apply DSEP.
static void ascon_aead_absorb_ad(ascon_state_t *s, const uint8_t *aad, size_t aad_len)
{
	if (aad_len > 0U) {
		size_t offset = 0;
		size_t remain = aad_len;

		// Blok penuh 16 byte: XOR ke x[0] (low 8 byte) dan x[1] (high 8 byte)
		while (remain >= ASCON_AEAD_RATE) {
			s->x[0] ^= ascon_loadbytes(aad + offset, 8);
			s->x[1] ^= ascon_loadbytes(aad + offset + 8, 8);
			ascon_permute(s, ASCON_PB_ROUNDS);
			offset += ASCON_AEAD_RATE;
			remain -= ASCON_AEAD_RATE;
		}

		// Blok terakhir parsial (0..15 byte) + padding 0x01
		if (remain >= 8U) {
			s->x[0] ^= ascon_loadbytes(aad + offset, 8);
			s->x[1] ^= ascon_loadbytes(aad + offset + 8, remain - 8);
			s->x[1] ^= ascon_pad(remain - 8);
		} else {
			s->x[0] ^= ascon_loadbytes(aad + offset, remain);
			s->x[0] ^= ascon_pad(remain);
		}
		ascon_permute(s, ASCON_PB_ROUNDS);
	}

	// Domain separation: selalu dilakukan (memisahkan fase AD vs payload).
	s->x[4] ^= ASCON_DSEP;
}

// Enkripsi payload: XOR plaintext ke state, output sebagai ciphertext.
static void ascon_aead_encrypt_payload(ascon_state_t *s, const uint8_t *plaintext, size_t plaintext_len, uint8_t *ciphertext)
{
	size_t offset = 0;
	size_t remain = plaintext_len;

	// Blok penuh 16 byte
	while (remain >= ASCON_AEAD_RATE) {
		s->x[0] ^= ascon_loadbytes(plaintext + offset, 8);
		s->x[1] ^= ascon_loadbytes(plaintext + offset + 8, 8);
		ascon_storebytes(ciphertext + offset, s->x[0], 8);
		ascon_storebytes(ciphertext + offset + 8, s->x[1], 8);
		ascon_permute(s, ASCON_PB_ROUNDS);
		offset += ASCON_AEAD_RATE;
		remain -= ASCON_AEAD_RATE;
	}

	// Blok terakhir (selalu dijalankan, walau remain=0 → XOR pad(0))
	if (remain >= 8U) {
		s->x[0] ^= ascon_loadbytes(plaintext + offset, 8);
		s->x[1] ^= ascon_loadbytes(plaintext + offset + 8, remain - 8);
		ascon_storebytes(ciphertext + offset, s->x[0], 8);
		ascon_storebytes(ciphertext + offset + 8, s->x[1], remain - 8);
		s->x[1] ^= ascon_pad(remain - 8);
	} else {
		s->x[0] ^= ascon_loadbytes(plaintext + offset, remain);
		ascon_storebytes(ciphertext + offset, s->x[0], remain);
		s->x[0] ^= ascon_pad(remain);
	}
	// NB: tidak ada P8 setelah blok terakhir — langsung ke finalize.
}

// Dekripsi payload: pulihkan plaintext dan reset bagian state yang
// "diisi ulang" oleh ciphertext (untuk meniru state encrypt).
static void ascon_aead_decrypt_payload(ascon_state_t *s, const uint8_t *ciphertext, size_t ciphertext_len, uint8_t *plaintext)
{
	size_t offset = 0;
	size_t remain = ciphertext_len;

	// Blok penuh 16 byte
	while (remain >= ASCON_AEAD_RATE) {
		uint64_t c0 = ascon_loadbytes(ciphertext + offset, 8);
		uint64_t c1 = ascon_loadbytes(ciphertext + offset + 8, 8);
		ascon_storebytes(plaintext + offset, s->x[0] ^ c0, 8);
		ascon_storebytes(plaintext + offset + 8, s->x[1] ^ c1, 8);
		s->x[0] = c0;
		s->x[1] = c1;
		ascon_permute(s, ASCON_PB_ROUNDS);
		offset += ASCON_AEAD_RATE;
		remain -= ASCON_AEAD_RATE;
	}

	// Blok terakhir parsial
	if (remain >= 8U) {
		uint64_t c0 = ascon_loadbytes(ciphertext + offset, 8);
		uint64_t c1 = ascon_loadbytes(ciphertext + offset + 8, remain - 8);
		ascon_storebytes(plaintext + offset, s->x[0] ^ c0, 8);
		ascon_storebytes(plaintext + offset + 8, s->x[1] ^ c1, remain - 8);
		s->x[0] = c0;
		s->x[1] = ascon_clear_first_n(s->x[1], remain - 8) | c1;
		s->x[1] ^= ascon_pad(remain - 8);
	} else {
		uint64_t c0 = ascon_loadbytes(ciphertext + offset, remain);
		ascon_storebytes(plaintext + offset, s->x[0] ^ c0, remain);
		s->x[0] = ascon_clear_first_n(s->x[0], remain) | c0;
		s->x[0] ^= ascon_pad(remain);
	}
}

// Finalize: XOR kunci ke x[2]/x[3] → P12 → XOR kunci ke x[3]/x[4] → tag = x[3]||x[4].
static void ascon_aead_finalize(ascon_state_t *s, const uint8_t key[ASCON_KEY_SIZE], uint8_t out_tag[ASCON_TAG_SIZE])
{
	uint64_t k0 = ascon_loadbytes(key, 8);
	uint64_t k1 = ascon_loadbytes(key + 8, 8);

	s->x[2] ^= k0;
	s->x[3] ^= k1;

	ascon_permute(s, ASCON_PA_ROUNDS);

	s->x[3] ^= k0;
	s->x[4] ^= k1;

	ascon_storebytes(out_tag, s->x[3], 8);
	ascon_storebytes(out_tag + 8, s->x[4], 8);
}

// Helper: bangun nonce 16-byte dari prefix (8B) + counter TX (8B big-endian).
// Konvensi BE counter di sini adalah application-level (firmware ↔ backend
// sama-sama parsing dengan urutan ini), BUKAN bagian dari spec Ascon.
static void ascon_nonce_from_parts(uint64_t prefix, uint64_t counter, uint8_t out_nonce[ASCON_NONCE_SIZE])
{
	for (int i = 7; i >= 0; i--) {
		out_nonce[i] = (uint8_t)(prefix & 0xFFU);
		prefix >>= 8;
	}
	for (int i = 7; i >= 0; i--) {
		out_nonce[8 + i] = (uint8_t)(counter & 0xFFU);
		counter >>= 8;
	}
}

// Pembanding tag constant-time agar tidak bocor lewat timing.
bool ascon_validate_tag_ct(const uint8_t expected[ASCON_TAG_SIZE], const uint8_t received[ASCON_TAG_SIZE])
{
	uint8_t diff = 0;
	for (size_t i = 0; i < ASCON_TAG_SIZE; i++) {
		diff |= (expected[i] ^ received[i]);
	}
	return diff == 0;
}

// AEAD encrypt (key argument, tidak pakai context).
static esp_err_t ascon_aead_encrypt_with_key(
	const uint8_t key[ASCON_KEY_SIZE],
	const uint8_t nonce[ASCON_NONCE_SIZE],
	const uint8_t *aad,
	size_t aad_len,
	const uint8_t *plaintext,
	size_t plaintext_len,
	uint8_t *ciphertext,
	uint8_t tag[ASCON_TAG_SIZE])
{
	ascon_state_t s = {0};
	ascon_aead_init(&s, key, nonce);
	ascon_aead_absorb_ad(&s, aad, aad_len);
	ascon_aead_encrypt_payload(&s, plaintext, plaintext_len, ciphertext);
	ascon_aead_finalize(&s, key, tag);
	ascon_secure_zero(&s, sizeof(s));
	return ESP_OK;
}

// AEAD decrypt dengan validasi tag konstan-waktu.
static esp_err_t ascon_aead_decrypt_with_key(
	const uint8_t key[ASCON_KEY_SIZE],
	const uint8_t nonce[ASCON_NONCE_SIZE],
	const uint8_t *aad,
	size_t aad_len,
	const uint8_t *ciphertext,
	size_t ciphertext_len,
	const uint8_t tag[ASCON_TAG_SIZE],
	uint8_t *plaintext)
{
	ascon_state_t s = {0};
	uint8_t computed_tag[ASCON_TAG_SIZE] = {0};

	ascon_aead_init(&s, key, nonce);
	ascon_aead_absorb_ad(&s, aad, aad_len);
	ascon_aead_decrypt_payload(&s, ciphertext, ciphertext_len, plaintext);
	ascon_aead_finalize(&s, key, computed_tag);

	bool valid = ascon_validate_tag_ct(computed_tag, tag);
	ascon_secure_zero(computed_tag, sizeof(computed_tag));
	ascon_secure_zero(&s, sizeof(s));

	if (!valid) {
		// Jangan kembalikan plaintext "tebakan" jika tag tidak valid.
		ascon_secure_zero(plaintext, ciphertext_len);
		return ESP_ERR_INVALID_CRC;
	}

	return ESP_OK;
}

// ============================================================================
// API tingkat aplikasi (manajemen konteks, key rotation, replay protection,
// nonce generation, dll).
// ============================================================================

esp_err_t ascon_init(ascon_ctx_t *ctx, const uint8_t key[ASCON_KEY_SIZE], uint32_t key_id)
{
	ESP_RETURN_ON_FALSE(ctx != NULL && key != NULL, ESP_ERR_INVALID_ARG, TAG, "argumen init tidak valid");

	memset(ctx, 0, sizeof(*ctx));
	memcpy(ctx->active_key, key, ASCON_KEY_SIZE);
	ctx->active_key_id = key_id;
	ctx->has_previous_key = false;

	// Prefix nonce random untuk mengurangi kolisi antar boot/session.
	esp_fill_random(&ctx->nonce_prefix, sizeof(ctx->nonce_prefix));
	if (ctx->nonce_prefix == 0U) {
		ctx->nonce_prefix = 1U;
	}

	ctx->tx_counter = 0U;
	ctx->last_rx_counter = ASCON_RX_COUNTER_UNSET;
	ctx->initialized = true;

	return ESP_OK;
}

esp_err_t ascon_deinit(ascon_ctx_t *ctx)
{
	ESP_RETURN_ON_FALSE(ctx != NULL, ESP_ERR_INVALID_ARG, TAG, "ctx null");
	ascon_secure_zero(ctx, sizeof(*ctx));
	return ESP_OK;
}

esp_err_t ascon_rotate_key(ascon_ctx_t *ctx, const uint8_t new_key[ASCON_KEY_SIZE], uint32_t new_key_id)
{
	ESP_RETURN_ON_FALSE(ctx != NULL && new_key != NULL, ESP_ERR_INVALID_ARG, TAG, "argumen rotate key tidak valid");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");

	memcpy(ctx->previous_key, ctx->active_key, ASCON_KEY_SIZE);
	ctx->previous_key_id = ctx->active_key_id;
	ctx->has_previous_key = true;

	memcpy(ctx->active_key, new_key, ASCON_KEY_SIZE);
	ctx->active_key_id = new_key_id;

	return ESP_OK;
}

esp_err_t ascon_set_tx_counter(ascon_ctx_t *ctx, uint64_t value)
{
	ESP_RETURN_ON_FALSE(ctx != NULL, ESP_ERR_INVALID_ARG, TAG, "ctx null");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");
	ctx->tx_counter = value;
	return ESP_OK;
}

uint64_t ascon_get_tx_counter(const ascon_ctx_t *ctx)
{
	if (ctx == NULL || !ctx->initialized) {
		return 0U;
	}
	return ctx->tx_counter;
}

esp_err_t ascon_set_last_rx_counter(ascon_ctx_t *ctx, uint64_t value)
{
	ESP_RETURN_ON_FALSE(ctx != NULL, ESP_ERR_INVALID_ARG, TAG, "ctx null");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");
	ctx->last_rx_counter = value;
	return ESP_OK;
}

uint64_t ascon_get_last_rx_counter(const ascon_ctx_t *ctx)
{
	if (ctx == NULL || !ctx->initialized) {
		return 0U;
	}
	return ctx->last_rx_counter;
}

esp_err_t ascon_set_nonce_prefix(ascon_ctx_t *ctx, uint64_t prefix)
{
	ESP_RETURN_ON_FALSE(ctx != NULL, ESP_ERR_INVALID_ARG, TAG, "ctx null");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");
	ESP_RETURN_ON_FALSE(prefix != 0U, ESP_ERR_INVALID_ARG, TAG, "prefix tidak boleh 0");
	ctx->nonce_prefix = prefix;
	return ESP_OK;
}

esp_err_t ascon_generate_nonce(ascon_ctx_t *ctx, uint8_t out_nonce[ASCON_NONCE_SIZE], uint64_t *out_counter)
{
	ESP_RETURN_ON_FALSE(ctx != NULL && out_nonce != NULL, ESP_ERR_INVALID_ARG, TAG, "argumen nonce tidak valid");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");

	uint64_t counter = ctx->tx_counter;
	ascon_nonce_from_parts(ctx->nonce_prefix, counter, out_nonce);

	ctx->tx_counter++;
	if (out_counter != NULL) {
		*out_counter = counter;
	}

	return ESP_OK;
}

uint64_t ascon_counter_from_nonce(const uint8_t nonce[ASCON_NONCE_SIZE])
{
	if (nonce == NULL) {
		return 0U;
	}
	// Counter di byte 8-15 dengan urutan BIG-ENDIAN (konvensi aplikasi).
	uint64_t counter = 0U;
	for (int i = 0; i < 8; i++) {
		counter = (counter << 8) | nonce[8 + i];
	}
	return counter;
}

bool ascon_is_fresh_counter(const ascon_ctx_t *ctx, uint64_t counter)
{
	if (ctx == NULL || !ctx->initialized) {
		return false;
	}

	if (ctx->last_rx_counter == ASCON_RX_COUNTER_UNSET) {
		return true;
	}

	return counter > ctx->last_rx_counter;
}

esp_err_t ascon_update_rx_counter(ascon_ctx_t *ctx, uint64_t counter)
{
	ESP_RETURN_ON_FALSE(ctx != NULL, ESP_ERR_INVALID_ARG, TAG, "ctx null");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");

	if (!ascon_is_fresh_counter(ctx, counter)) {
		return ESP_ERR_INVALID_STATE;
	}

	ctx->last_rx_counter = counter;
	return ESP_OK;
}

esp_err_t ascon_aead_encrypt(
	const ascon_ctx_t *ctx,
	const uint8_t nonce[ASCON_NONCE_SIZE],
	const uint8_t *aad,
	size_t aad_len,
	const uint8_t *plaintext,
	size_t plaintext_len,
	uint8_t *ciphertext,
	uint8_t tag[ASCON_TAG_SIZE])
{
	ESP_RETURN_ON_FALSE(ctx != NULL && nonce != NULL && tag != NULL, ESP_ERR_INVALID_ARG, TAG, "argumen encrypt tidak valid");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");

	if (plaintext_len > 0U) {
		ESP_RETURN_ON_FALSE(plaintext != NULL && ciphertext != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer plaintext/ciphertext null");
	}

	if (aad_len > 0U) {
		ESP_RETURN_ON_FALSE(aad != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer aad null");
	}

	return ascon_aead_encrypt_with_key(ctx->active_key, nonce, aad, aad_len, plaintext, plaintext_len, ciphertext, tag);
}

esp_err_t ascon_aead_decrypt(
	const ascon_ctx_t *ctx,
	const uint8_t nonce[ASCON_NONCE_SIZE],
	const uint8_t *aad,
	size_t aad_len,
	const uint8_t *ciphertext,
	size_t ciphertext_len,
	const uint8_t tag[ASCON_TAG_SIZE],
	uint8_t *plaintext,
	uint32_t *out_key_id)
{
	ESP_RETURN_ON_FALSE(
		ctx != NULL && nonce != NULL && tag != NULL && plaintext != NULL,
		ESP_ERR_INVALID_ARG,
		TAG,
		"argumen decrypt tidak valid");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");

	if (ciphertext_len > 0U) {
		ESP_RETURN_ON_FALSE(ciphertext != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer ciphertext null");
	}

	if (aad_len > 0U) {
		ESP_RETURN_ON_FALSE(aad != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer aad null");
	}

	// Coba active key dulu — bila gagal, fallback ke previous key (key rotation).
	esp_err_t err = ascon_aead_decrypt_with_key(ctx->active_key, nonce, aad, aad_len, ciphertext, ciphertext_len, tag, plaintext);
	if (err == ESP_OK) {
		if (out_key_id != NULL) {
			*out_key_id = ctx->active_key_id;
		}
		return ESP_OK;
	}

	if (ctx->has_previous_key) {
		err = ascon_aead_decrypt_with_key(ctx->previous_key, nonce, aad, aad_len, ciphertext, ciphertext_len, tag, plaintext);
		if (err == ESP_OK) {
			if (out_key_id != NULL) {
				*out_key_id = ctx->previous_key_id;
			}
			return ESP_OK;
		}
	}

	return ESP_ERR_INVALID_CRC;
}

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
	uint64_t *out_counter)
{
	ESP_RETURN_ON_FALSE(
		ctx != NULL && out_nonce != NULL && out_tag != NULL,
		ESP_ERR_INVALID_ARG,
		TAG,
		"argumen encrypt telemetry tidak valid");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");

	if (telemetry_len > 0U) {
		ESP_RETURN_ON_FALSE(telemetry != NULL && out_ciphertext != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer telemetry/cipher null");
	}

	if (aad_len > 0U) {
		ESP_RETURN_ON_FALSE(aad != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer aad null");
	}

	uint64_t counter = 0U;
	ESP_RETURN_ON_ERROR(ascon_generate_nonce(ctx, out_nonce, &counter), TAG, "generate nonce gagal");
	ESP_RETURN_ON_ERROR(
		ascon_aead_encrypt(ctx, out_nonce, aad, aad_len, telemetry, telemetry_len, out_ciphertext, out_tag),
		TAG,
		"encrypt telemetry gagal");

	if (out_key_id != NULL) {
		*out_key_id = ctx->active_key_id;
	}

	if (out_counter != NULL) {
		*out_counter = counter;
	}

	return ESP_OK;
}

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
	uint64_t *out_counter)
{
	ESP_RETURN_ON_FALSE(
		ctx != NULL && nonce != NULL && tag != NULL && out_plaintext != NULL,
		ESP_ERR_INVALID_ARG,
		TAG,
		"argumen decrypt command tidak valid");
	ESP_RETURN_ON_FALSE(ctx->initialized, ESP_ERR_INVALID_STATE, TAG, "ctx belum init");

	if (ciphertext_len > 0U) {
		ESP_RETURN_ON_FALSE(ciphertext != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer ciphertext null");
	}

	if (aad_len > 0U) {
		ESP_RETURN_ON_FALSE(aad != NULL, ESP_ERR_INVALID_ARG, TAG, "buffer aad null");
	}

	uint64_t counter = ascon_counter_from_nonce(nonce);
	if (!ascon_is_fresh_counter(ctx, counter)) {
		ESP_LOGW(TAG, "replay terdeteksi: counter=%llu last=%llu", (unsigned long long)counter, (unsigned long long)ctx->last_rx_counter);
		return ESP_ERR_INVALID_STATE;
	}

	ESP_RETURN_ON_ERROR(
		ascon_aead_decrypt(ctx, nonce, aad, aad_len, ciphertext, ciphertext_len, tag, out_plaintext, out_key_id),
		TAG,
		"decrypt/tag validation gagal");

	ESP_RETURN_ON_ERROR(ascon_update_rx_counter(ctx, counter), TAG, "update replay window gagal");

	if (out_counter != NULL) {
		*out_counter = counter;
	}

	return ESP_OK;
}
