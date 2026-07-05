/* ============================================================================
 * interactive.c
 * Penguji interaktif algoritma Ascon-AEAD128 (NIST SP 800-232, final
 * 13 Agustus 2025) dengan input manual via terminal.
 *
 * STRUKTUR FILE:
 *   [BAGIAN A]  Implementasi algoritma Ascon-AEAD128.
 *               -> IDENTIK dengan kode firmware pada
 *                  firmware/core/components/ascon_crypto/ascon.c
 *               (nama makro, nama fungsi, urutan, dan logika sengaja dijaga
 *                sama persis agar mudah dibandingkan secara visual).
 *
 *   [BAGIAN B]  Test harness interaktif (parsing input hex/text, prompt CLI,
 *               pretty-print hasil, mode demo).
 *               -> Kode khusus untuk pengujian via terminal, TIDAK ada pada
 *                  firmware.
 *
 * Kebenaran dan ekuivalensi Bagian A terhadap ascon.c dapat dibuktikan dengan
 * membandingkan output program ini terhadap berkas LWC_AEAD_KAT_128_128.txt
 * (1089 Known Answer Test vector resmi NIST SP 800-232) yang ada di folder
 * yang sama.
 *
 * Tidak ada library kriptografi eksternal — seluruh permutasi, S-box,
 * linear diffusion, padding, dan finalisasi ditulis langsung mengikuti
 * spesifikasi resmi NIST SP 800-232.
 *
 * -----------------------------------------------------------------------------
 * BUILD (gcc / clang, standar C11):
 *     gcc -std=c11 -O2 -Wall interactive.c -o interactive
 *
 * JALANKAN:
 *     ./interactive            -> mode interaktif (input via prompt)
 *     ./interactive --demo     -> jalankan 3 vektor contoh siap pakai
 *
 * FORMAT INPUT MODE INTERAKTIF:
 *     Key   : 32 karakter hex (16 byte / 128 bit)  WAJIB
 *     Nonce : 32 karakter hex (16 byte / 128 bit)  WAJIB
 *     PT    : hex (bebas panjang) ATAU diawali "text:" untuk teks ASCII
 *     AD    : hex (bebas panjang) ATAU diawali "text:" untuk teks ASCII
 *
 * Tekan Enter pada Key/Nonce untuk memakai default NIST KAT
 *     (Key = 000102...0F, Nonce = 1011...1F).
 * Tekan Enter pada PT/AD untuk meninggalkan kosong.
 * ============================================================================
 */

#include <ctype.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>


/* ###########################################################################
 * #                                                                         #
 * #                              BAGIAN A                                   #
 * #         IMPLEMENTASI ALGORITMA ASCON-AEAD128 (NIST SP 800-232)          #
 * #                                                                         #
 * #   Kode di bawah ini IDENTIK dengan implementasi firmware pada:          #
 * #     firmware/core/components/ascon_crypto/ascon.c                       #
 * #                                                                         #
 * #   Setiap perubahan pada bagian ini WAJIB disinkronkan dengan ascon.c    #
 * #   agar firmware dan tester ini tetap menghasilkan ciphertext + tag      #
 * #   identik bit demi bit (diverifikasi via KAT NIST resmi).               #
 * #                                                                         #
 * ###########################################################################
 */

/* --- Parameter Ascon-AEAD128 sesuai NIST SP 800-232 §3.2 --- */
#define ASCON_KEY_SIZE     16
#define ASCON_NONCE_SIZE   16
#define ASCON_TAG_SIZE     16
#define ASCON_AEAD_RATE    16
#define ASCON_PA_ROUNDS    12
#define ASCON_PB_ROUNDS    8

/* IV Ascon-AEAD128 dihitung dari parameter (SP 800-232 §3.2):
 *   variant = 1 (AEAD), pa = 12, pb = 8, tag_bits = 128, rate = 16 byte
 * Hasil (little-endian word 64-bit): 0x0000_1000_808C_0001 */
#define ASCON_AEAD128_IV                    \
    (((uint64_t)1U   << 0)  |               \
     ((uint64_t)12U  << 16) |               \
     ((uint64_t)8U   << 20) |               \
     ((uint64_t)128U << 24) |               \
     ((uint64_t)16U  << 40))

/* Domain separation: bit MSB (0x80) di byte ke-7 dari x[4]. */
#define ASCON_DSEP ((uint64_t)0x80U << 56)

/* State Ascon: array 5 word 64-bit (sesuai notasi spec NIST x[0]..x[4]). */
typedef struct {
    uint64_t x[5];
} ascon_state_t;

/* Round constants p[12] — sama untuk semua varian Ascon. */
static const uint8_t ASCON_RC[12] = {
    0xF0, 0xE1, 0xD2, 0xC3, 0xB4, 0xA5,
    0x96, 0x87, 0x78, 0x69, 0x5A, 0x4B,
};

/* Rotasi kanan 64-bit (untuk linear diffusion layer). */
static inline uint64_t ascon_rotr64(uint64_t x, uint32_t n)
{
    return (x >> n) | (x << (64U - n));
}

/* Load n byte (n=0..8) menjadi word 64-bit LITTLE-ENDIAN. */
static uint64_t ascon_loadbytes(const uint8_t *bytes, size_t n)
{
    uint64_t x = 0U;
    for (size_t i = 0; i < n; i++) {
        x |= ((uint64_t)bytes[i]) << (8U * i);
    }
    return x;
}

/* Store n byte (n=0..8) dari word 64-bit dalam urutan LITTLE-ENDIAN. */
static void ascon_storebytes(uint8_t *bytes, uint64_t x, size_t n)
{
    for (size_t i = 0; i < n; i++) {
        bytes[i] = (uint8_t)((x >> (8U * i)) & 0xFFU);
    }
}

/* Padding byte 0x01 di posisi byte ke-i (LE encoding). */
static inline uint64_t ascon_pad(size_t i)
{
    return ((uint64_t)0x01U) << (8U * i);
}

/* Nolkan n byte pertama (byte 0..n-1), mempertahankan byte n..7.
 * Setara CLEARBYTES(x, n) di referensi C IAIK. */
static uint64_t ascon_clear_first_n(uint64_t x, size_t n)
{
    for (size_t i = 0; i < n; i++) {
        x &= ~(((uint64_t)0xFFU) << (8U * i));
    }
    return x;
}

/* Zero-out buffer sebelum dibebaskan (mengurangi risiko key residue di memori). */
static void ascon_secure_zero(void *ptr, size_t len)
{
    volatile uint8_t *p = (volatile uint8_t *)ptr;
    while (len--) {
        *p++ = 0;
    }
}

/* Permutasi Ascon p[r] — round function identik dengan v1.2.
 * r=12 untuk init/finalize, r=8 untuk per-blok rate (di SP 800-232). */
static void ascon_permute(ascon_state_t *s, int rounds)
{
    int start = 12 - rounds;

    for (int i = start; i < 12; i++) {
        /* (1) Penambahan round constant ke x[2] */
        s->x[2] ^= (uint64_t)ASCON_RC[i];

        /* (2) Substitution layer (S-box 5-bit Ascon) */
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

        /* (3) Linear diffusion layer (rotasi per word) */
        s->x[0] ^= ascon_rotr64(s->x[0], 19) ^ ascon_rotr64(s->x[0], 28);
        s->x[1] ^= ascon_rotr64(s->x[1], 61) ^ ascon_rotr64(s->x[1], 39);
        s->x[2] ^= ascon_rotr64(s->x[2], 1)  ^ ascon_rotr64(s->x[2], 6);
        s->x[3] ^= ascon_rotr64(s->x[3], 10) ^ ascon_rotr64(s->x[3], 17);
        s->x[4] ^= ascon_rotr64(s->x[4], 7)  ^ ascon_rotr64(s->x[4], 41);
    }
}

/* Init: load IV+key+nonce -> P12 -> XOR kunci kembali ke x[3], x[4]. */
static void ascon_aead_init(ascon_state_t *s,
                            const uint8_t key[ASCON_KEY_SIZE],
                            const uint8_t nonce[ASCON_NONCE_SIZE])
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

/* Absorb Associated Data — kalau aad_len=0, lewati blok AD; tetap apply DSEP. */
static void ascon_aead_absorb_ad(ascon_state_t *s, const uint8_t *aad, size_t aad_len)
{
    if (aad_len > 0U) {
        size_t offset = 0;
        size_t remain = aad_len;

        /* Blok penuh 16 byte: XOR ke x[0] (low 8 byte) dan x[1] (high 8 byte) */
        while (remain >= ASCON_AEAD_RATE) {
            s->x[0] ^= ascon_loadbytes(aad + offset, 8);
            s->x[1] ^= ascon_loadbytes(aad + offset + 8, 8);
            ascon_permute(s, ASCON_PB_ROUNDS);
            offset += ASCON_AEAD_RATE;
            remain -= ASCON_AEAD_RATE;
        }

        /* Blok terakhir parsial (0..15 byte) + padding 0x01 */
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

    /* Domain separation: selalu dilakukan (memisahkan fase AD vs payload). */
    s->x[4] ^= ASCON_DSEP;
}

/* Enkripsi payload: XOR plaintext ke state, output sebagai ciphertext. */
static void ascon_aead_encrypt_payload(ascon_state_t *s,
                                       const uint8_t *plaintext,
                                       size_t plaintext_len,
                                       uint8_t *ciphertext)
{
    size_t offset = 0;
    size_t remain = plaintext_len;

    /* Blok penuh 16 byte */
    while (remain >= ASCON_AEAD_RATE) {
        s->x[0] ^= ascon_loadbytes(plaintext + offset, 8);
        s->x[1] ^= ascon_loadbytes(plaintext + offset + 8, 8);
        ascon_storebytes(ciphertext + offset, s->x[0], 8);
        ascon_storebytes(ciphertext + offset + 8, s->x[1], 8);
        ascon_permute(s, ASCON_PB_ROUNDS);
        offset += ASCON_AEAD_RATE;
        remain -= ASCON_AEAD_RATE;
    }

    /* Blok terakhir (selalu dijalankan, walau remain=0 -> XOR pad(0)) */
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
    /* NB: tidak ada P8 setelah blok terakhir — langsung ke finalize. */
}

/* Dekripsi payload: pulihkan plaintext dan reset bagian state yang
 * "diisi ulang" oleh ciphertext (untuk meniru state encrypt). */
static void ascon_aead_decrypt_payload(ascon_state_t *s,
                                       const uint8_t *ciphertext,
                                       size_t ciphertext_len,
                                       uint8_t *plaintext)
{
    size_t offset = 0;
    size_t remain = ciphertext_len;

    /* Blok penuh 16 byte */
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

    /* Blok terakhir parsial */
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

/* Finalize: XOR kunci ke x[2]/x[3] -> P12 -> XOR kunci ke x[3]/x[4]
 * -> tag = x[3] || x[4]. */
static void ascon_aead_finalize(ascon_state_t *s,
                                const uint8_t key[ASCON_KEY_SIZE],
                                uint8_t out_tag[ASCON_TAG_SIZE])
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

/* Pembanding tag constant-time agar tidak bocor lewat timing. */
static bool ascon_validate_tag_ct(const uint8_t expected[ASCON_TAG_SIZE],
                                  const uint8_t received[ASCON_TAG_SIZE])
{
    uint8_t diff = 0;
    for (size_t i = 0; i < ASCON_TAG_SIZE; i++) {
        diff |= (expected[i] ^ received[i]);
    }
    return diff == 0;
}

/* AEAD encrypt low-level (key argument, tidak pakai context). */
static void ascon_aead_encrypt_with_key(
    const uint8_t key[ASCON_KEY_SIZE],
    const uint8_t nonce[ASCON_NONCE_SIZE],
    const uint8_t *aad,
    size_t aad_len,
    const uint8_t *plaintext,
    size_t plaintext_len,
    uint8_t *ciphertext,
    uint8_t tag[ASCON_TAG_SIZE])
{
    ascon_state_t s = { { 0, 0, 0, 0, 0 } };
    ascon_aead_init(&s, key, nonce);
    ascon_aead_absorb_ad(&s, aad, aad_len);
    ascon_aead_encrypt_payload(&s, plaintext, plaintext_len, ciphertext);
    ascon_aead_finalize(&s, key, tag);
    ascon_secure_zero(&s, sizeof(s));
}

/* AEAD decrypt low-level dengan validasi tag konstan-waktu.
 * Mengembalikan true jika tag valid, false jika gagal (plaintext di-wipe). */
static bool ascon_aead_decrypt_with_key(
    const uint8_t key[ASCON_KEY_SIZE],
    const uint8_t nonce[ASCON_NONCE_SIZE],
    const uint8_t *aad,
    size_t aad_len,
    const uint8_t *ciphertext,
    size_t ciphertext_len,
    const uint8_t tag[ASCON_TAG_SIZE],
    uint8_t *plaintext)
{
    ascon_state_t s = { { 0, 0, 0, 0, 0 } };
    uint8_t computed_tag[ASCON_TAG_SIZE] = { 0 };

    ascon_aead_init(&s, key, nonce);
    ascon_aead_absorb_ad(&s, aad, aad_len);
    ascon_aead_decrypt_payload(&s, ciphertext, ciphertext_len, plaintext);
    ascon_aead_finalize(&s, key, computed_tag);

    bool valid = ascon_validate_tag_ct(computed_tag, tag);
    ascon_secure_zero(computed_tag, sizeof(computed_tag));
    ascon_secure_zero(&s, sizeof(s));

    if (!valid) {
        /* Jangan kembalikan plaintext "tebakan" jika tag tidak valid. */
        ascon_secure_zero(plaintext, ciphertext_len);
        return false;
    }
    return true;
}

/* ###########################################################################
 * #                          AKHIR BAGIAN A                                 #
 * ###########################################################################
 */


/* ###########################################################################
 * #                                                                         #
 * #                              BAGIAN B                                   #
 * #                  TEST HARNESS INTERAKTIF (CLI)                          #
 * #                                                                         #
 * #   Kode di bawah ini KHUSUS untuk program penguji ini — tidak ada pada   #
 * #   firmware. Fungsinya: parsing input hex/text dari user, prompt CLI,    #
 * #   pretty-print hasil, demo tampering, dan mode demo siap pakai.         #
 * #                                                                         #
 * ###########################################################################
 */

/* --- Utilitas parsing input ---------------------------------------------- */
static int hex_char_value(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/* Parse input dari string mentah:
 *   - jika diawali "text:" -> ambil sisa string sebagai bytes (ASCII literal)
 *   - selain itu          -> parse sebagai hex (whitespace di-ignore)
 */
static int parse_input(const char *raw, uint8_t *out, size_t out_cap,
                       size_t *out_len, const char *fieldname)
{
    size_t rlen = strlen(raw);

    if (rlen >= 5 && strncmp(raw, "text:", 5) == 0) {
        const char *txt = raw + 5;
        size_t tlen = strlen(txt);
        if (tlen > out_cap) {
            fprintf(stderr, "  Error: %s (text) terlalu panjang (%zu byte, maks %zu)\n",
                    fieldname, tlen, out_cap);
            return -1;
        }
        memcpy(out, txt, tlen);
        *out_len = tlen;
        return 0;
    }

    size_t n = 0;
    int nibble = -1;
    for (size_t i = 0; i < rlen; i++) {
        char c = raw[i];
        if (isspace((unsigned char)c)) continue;
        int v = hex_char_value(c);
        if (v < 0) {
            fprintf(stderr, "  Error: %s bukan hex valid (karakter '%c')\n", fieldname, c);
            return -1;
        }
        if (nibble < 0) {
            nibble = v;
        } else {
            if (n >= out_cap) {
                fprintf(stderr, "  Error: %s terlalu panjang (maks %zu byte)\n",
                        fieldname, out_cap);
                return -1;
            }
            out[n++] = (uint8_t)((nibble << 4) | v);
            nibble = -1;
        }
    }
    if (nibble >= 0) {
        fprintf(stderr, "  Error: %s memiliki jumlah nibble ganjil\n", fieldname);
        return -1;
    }
    *out_len = n;
    return 0;
}

/* --- Utilitas output ----------------------------------------------------- */
static void print_hex(const char *label, const uint8_t *buf, size_t len)
{
    printf("  %-20s : ", label);
    if (len == 0) {
        printf("(kosong)");
    } else {
        for (size_t i = 0; i < len; i++) printf("%02X", buf[i]);
    }
    printf("   (%zu byte)\n", len);
}

static bool is_printable_ascii(const uint8_t *buf, size_t len)
{
    if (len == 0) return false;
    for (size_t i = 0; i < len; i++) {
        uint8_t c = buf[i];
        if (!(c == 0x09 || c == 0x0A || c == 0x0D || (c >= 0x20 && c <= 0x7E))) {
            return false;
        }
    }
    return true;
}

static void print_text_if_ascii(const char *label, const uint8_t *buf, size_t len)
{
    if (!is_printable_ascii(buf, len)) return;
    printf("  %-20s : \"", label);
    for (size_t i = 0; i < len; i++) putchar(buf[i]);
    printf("\"\n");
}

static void print_divider(char c, int n)
{
    for (int i = 0; i < n; i++) putchar(c);
    putchar('\n');
}

/* --- Pipeline 1 vektor: encrypt + roundtrip + tamper demo --------------- */
static void run_vector(const uint8_t *key,   size_t klen,
                       const uint8_t *nonce, size_t nlen,
                       const uint8_t *pt,    size_t ptlen,
                       const uint8_t *ad,    size_t adlen)
{
    if (klen != ASCON_KEY_SIZE || nlen != ASCON_NONCE_SIZE) {
        fprintf(stderr, "  Error: Key/Nonce harus tepat 16 byte\n");
        return;
    }

    uint8_t *ct  = (uint8_t *)calloc(ptlen + 1, 1);
    uint8_t *rec = (uint8_t *)calloc(ptlen + 1, 1);
    uint8_t tag[ASCON_TAG_SIZE];

    /* === Panggilan ke Bagian A: enkripsi === */
    ascon_aead_encrypt_with_key(key, nonce, ad, adlen, pt, ptlen, ct, tag);

    putchar('\n');
    print_divider('=', 72);
    puts("  HASIL ENKRIPSI ASCON-AEAD128 (NIST SP 800-232)");
    print_divider('=', 72);
    print_hex("Key",        key,   klen);
    print_hex("Nonce",      nonce, nlen);
    print_hex("PT  (hex)",  pt,    ptlen);
    print_text_if_ascii("PT  (text)", pt, ptlen);
    print_hex("AD  (hex)",  ad,    adlen);
    print_text_if_ascii("AD  (text)", ad, adlen);
    print_divider('-', 72);
    print_hex("Ciphertext", ct,    ptlen);
    print_hex("Tag",        tag,   ASCON_TAG_SIZE);
    print_divider('=', 72);

    /* === Panggilan ke Bagian A: dekripsi roundtrip === */
    putchar('\n');
    puts("Verifikasi roundtrip (dekripsi -> plaintext asli):");
    bool ok = ascon_aead_decrypt_with_key(key, nonce, ad, adlen,
                                          ct, ptlen, tag, rec);
    if (!ok) {
        puts("  GAGAL: tag tidak valid (mustahil utk input yg baru dienkripsi)");
    } else if (memcmp(rec, pt, ptlen) == 0) {
        printf("  SUKSES: plaintext berhasil di-recover (%zu byte)\n", ptlen);
        print_hex("PT recovered (hex)", rec, ptlen);
        print_text_if_ascii("PT recovered (text)", rec, ptlen);
    } else {
        puts("  GAGAL: plaintext hasil dekripsi BERBEDA dari aslinya!");
    }

    /* === Panggilan ke Bagian A: demo tamper detection === */
    if (ptlen > 0) {
        putchar('\n');
        puts("Demo tampering (flip 1 bit pada ciphertext, harus ditolak):");
        uint8_t *tampered = (uint8_t *)malloc(ptlen);
        uint8_t *rec2     = (uint8_t *)calloc(ptlen + 1, 1);
        memcpy(tampered, ct, ptlen);
        tampered[0] ^= 0x01;
        bool ok2 = ascon_aead_decrypt_with_key(key, nonce, ad, adlen,
                                               tampered, ptlen, tag, rec2);
        if (!ok2) {
            puts("  BENAR: tag invalid -> dekripsi ditolak (proteksi integritas berfungsi)");
        } else {
            puts("  ANOMALI: tampering tidak terdeteksi!");
        }
        free(tampered);
        free(rec2);
    }

    free(ct);
    free(rec);
    putchar('\n');
}

/* --- Pembaca baris dari stdin dengan default value ---------------------- */
static void read_line(const char *prompt, const char *def_val, char *out, size_t cap)
{
    if (def_val && def_val[0]) {
        printf("%s [default: %s]\n> ", prompt, def_val);
    } else {
        printf("%s\n> ", prompt);
    }
    fflush(stdout);

    if (!fgets(out, (int)cap, stdin)) {
        out[0] = '\0';
        return;
    }

    /* trim CR/LF di akhir */
    size_t len = strlen(out);
    while (len > 0 && (out[len - 1] == '\n' || out[len - 1] == '\r')) {
        out[--len] = '\0';
    }
    /* trim trailing space */
    while (len > 0 && isspace((unsigned char)out[len - 1])) out[--len] = '\0';
    /* trim leading space */
    char *start = out;
    while (*start && isspace((unsigned char)*start)) start++;
    if (start != out) memmove(out, start, strlen(start) + 1);

    if (out[0] == '\0' && def_val && def_val[0]) {
        strncpy(out, def_val, cap - 1);
        out[cap - 1] = '\0';
    }
}

/* --- Mode interaktif ---------------------------------------------------- */
static void mode_interactive(void)
{
    putchar('\n');
    print_divider('=', 72);
    puts("  TEST VECTOR ASCON-AEAD128 (NIST SP 800-232) - INPUT MANUAL VIA CLI");
    print_divider('=', 72);
    puts("  Format input:");
    puts("    Key  : hex 32 karakter (16 byte / 128 bit)  WAJIB");
    puts("    Nonce: hex 32 karakter (16 byte / 128 bit)  WAJIB");
    puts("    PT   : hex (boleh kosong) ATAU diawali 'text:' utk string biasa");
    puts("    AD   : hex (boleh kosong) ATAU diawali 'text:' utk string biasa");
    puts("");
    puts("  Tekan Enter pada PT/AD untuk biarkan kosong.");
    puts("  Tekan Enter pada Key/Nonce untuk pakai default NIST KAT.");
    print_divider('=', 72);

    static const char *def_key   = "000102030405060708090A0B0C0D0E0F";
    static const char *def_nonce = "101112131415161718191A1B1C1D1E1F";

    char key_raw[1024];
    char nonce_raw[1024];
    char pt_raw[8192];
    char ad_raw[8192];

    read_line("Masukkan Key (hex 32 char):",            def_key,   key_raw,   sizeof(key_raw));
    read_line("Masukkan Nonce (hex 32 char):",          def_nonce, nonce_raw, sizeof(nonce_raw));
    read_line("Masukkan Plaintext (hex / text:...):",   "",        pt_raw,    sizeof(pt_raw));
    read_line("Masukkan Associated Data (hex / text:...):", "",    ad_raw,    sizeof(ad_raw));

    uint8_t key[64];
    uint8_t nonce[64];
    uint8_t pt[4096];
    uint8_t ad[4096];
    size_t klen = 0, nlen = 0, ptlen = 0, adlen = 0;

    if (parse_input(key_raw,   key,   sizeof(key),   &klen,  "Key")   != 0) exit(1);
    if (parse_input(nonce_raw, nonce, sizeof(nonce), &nlen,  "Nonce") != 0) exit(1);
    if (parse_input(pt_raw,    pt,    sizeof(pt),    &ptlen, "PT")    != 0) exit(1);
    if (parse_input(ad_raw,    ad,    sizeof(ad),    &adlen, "AD")    != 0) exit(1);

    if (klen != ASCON_KEY_SIZE) {
        fprintf(stderr, "Key harus 16 byte (32 hex char). Anda input %zu byte.\n", klen);
        exit(1);
    }
    if (nlen != ASCON_NONCE_SIZE) {
        fprintf(stderr, "Nonce harus 16 byte (32 hex char). Anda input %zu byte.\n", nlen);
        exit(1);
    }

    run_vector(key, klen, nonce, nlen, pt, ptlen, ad, adlen);
}

/* --- Mode demo (3 vektor contoh siap pakai) ----------------------------- */
static void mode_demo(void)
{
    putchar('\n');
    puts("Mode DEMO - 3 contoh test vector Ascon-AEAD128 (NIST SP 800-232):");

    /* Demo 1: string "Hello VoltGuard!" + AD device-001 */
    static const uint8_t k1[16] = {
        0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
        0x08,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,0x0F
    };
    static const uint8_t n1[16] = {
        0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,
        0x18,0x19,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F
    };
    const char *pt1 = "Hello VoltGuard!";
    const char *ad1 = "device-001";
    run_vector(k1, 16, n1, 16,
               (const uint8_t *)pt1, strlen(pt1),
               (const uint8_t *)ad1, strlen(ad1));

    /* Demo 2: payload JSON telemetri */
    static const uint8_t k2[16] = {
        0xAA,0xBB,0xCC,0xDD,0xEE,0xFF,0x00,0x11,
        0x22,0x33,0x44,0x55,0x66,0x77,0x88,0x99
    };
    static const uint8_t n2[16] = {
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01
    };
    const char *pt2 = "{\"v\":220.5,\"i\":2.3,\"p\":507.15}";
    const char *ad2 = "smart-socket-A1";
    run_vector(k2, 16, n2, 16,
               (const uint8_t *)pt2, strlen(pt2),
               (const uint8_t *)ad2, strlen(ad2));

    /* Demo 3: command on/off, AD kosong */
    static const uint8_t k3[16] = {
        0x01,0x23,0x45,0x67,0x89,0xAB,0xCD,0xEF,
        0x01,0x23,0x45,0x67,0x89,0xAB,0xCD,0xEF
    };
    static const uint8_t n3[16] = {
        0xCA,0xFE,0xBA,0xBE,0xDE,0xAD,0xBE,0xEF,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x42
    };
    const char *pt3 = "{\"command\":\"on\"}";
    run_vector(k3, 16, n3, 16,
               (const uint8_t *)pt3, strlen(pt3),
               NULL, 0);
}

int main(int argc, char **argv)
{
    bool demo = false;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--demo") == 0) demo = true;
    }

    if (demo) {
        mode_demo();
    } else {
        mode_interactive();
    }
    return 0;
}

/* ###########################################################################
 * #                          AKHIR BAGIAN B                                 #
 * ###########################################################################
 */
