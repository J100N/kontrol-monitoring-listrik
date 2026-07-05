a. Inisialisasi Sistem pada ESP32-S3

Fungsi app_main merupakan titik awal eksekusi pada endpoint soket pintar. Pada versi terbaru, sistem tidak hanya menginisialisasi konteks ASCON-AEAD128, device state, OLED SSD1306, PZEM-004T, relay SLA-5VDC-SL-C, sensor PIR HC-SR501, dan auto control, tetapi juga menginisialisasi NVS sejak awal. NVS digunakan untuk melanjutkan counter ASCON setelah reboot sehingga counter paket tetap monoton dan data tidak ditolak oleh backend sebagai replay. Konfigurasi auto control juga dibaca dari NVS apabila sebelumnya pernah diubah dari dashboard.

void app_main(void)
{
    const TickType_t pzem_interval_ticks = pdMS_TO_TICKS(1000);
    const uint8_t ascon_key[ASCON_KEY_SIZE] = ASCON_KEY_BYTES;
    esp_err_t pzem_ret = ESP_OK;

    ESP_LOGI(TAG, "Booting device: %s", DEVICE_ID);

    esp_err_t nvs_ret = nvs_flash_init();
    if (nvs_ret == ESP_ERR_NVS_NO_FREE_PAGES ||
        nvs_ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs_ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs_ret);

    ESP_ERROR_CHECK(ascon_init(&s_ascon, ascon_key, ASCON_KEY_ID));

    uint64_t ctr_start = ascon_ctr_nvs_load_and_reserve();
    ESP_ERROR_CHECK(ascon_set_tx_counter(&s_ascon, ctr_start));
    ESP_LOGI(TAG, "[%s] Counter ASCON dilanjutkan dari NVS: %llu",
             DEVICE_ID, (unsigned long long)ctr_start);

    ESP_ERROR_CHECK(device_state_init());
    ESP_ERROR_CHECK(device_state_set_device_online(true));
    ESP_ERROR_CHECK(device_state_set_mode(DEVICE_WORK_MODE_AUTOMATIC));

    esp_err_t oled_ret = oled_init(NULL);
    if (oled_ret == ESP_OK) {
        refresh_oled_from_state();
    }

    pzem_ret = pzem_init(NULL);
    if (pzem_ret == ESP_OK) {
        pzem_data_t early_data = {0};
        if (pzem_read_data(&early_data) == ESP_OK) {
            device_state_set_last_power(early_data.power_w);
            refresh_oled_from_state();
        }
    }

    ESP_ERROR_CHECK(relay_init(NULL));
    ESP_ERROR_CHECK(device_state_set_relay(relay_get_state()));
    refresh_oled_from_state();

    ESP_ERROR_CHECK(pir_init(NULL));

    uint32_t auto_pir_sec = AUTO_CONTROL_NO_MOTION_OFF_SEC;
    float auto_thr_w = AUTO_CONTROL_POWER_THRESHOLD_W;
    autocfg_nvs_load(&auto_pir_sec, &auto_thr_w);

    auto_control_config_t auto_cfg = {
        .no_motion_off_delay_sec = auto_pir_sec,
        .power_threshold_w = auto_thr_w,
        .enable_auto_on = true,
        .enable_auto_off = true,
    };
    ESP_ERROR_CHECK(auto_control_init(&auto_cfg));

    BaseType_t conn_task_ok = xTaskCreate(connectivity_task, "conn_task",
                                          6144, NULL, 5, NULL);
    if (conn_task_ok != pdPASS) {
        ESP_LOGE(TAG, "[%s] Gagal membuat task konektivitas", DEVICE_ID);
    }

    /* loop utama: baca PZEM per 1 detik, simpan ke buffer, kirim batch 10 sampel,
       sinkronisasi counter ASCON ke NVS, dan evaluasi auto control */
}

b. Pembacaan Parameter Listrik PZEM-004T

Komunikasi ESP32-S3 dengan PZEM-004T dilakukan melalui UART dengan protokol Modbus RTU. Pada setiap siklus, firmware membangun frame Read Input Register, membersihkan buffer RX, mengirim request, menunggu respons penuh, memvalidasi alamat, function code, ukuran payload, dan CRC, kemudian mengonversi register menjadi nilai fisik. Pada versi terbaru loop utama membaca PZEM setiap 1000 ms sehingga data daya yang dipakai auto control diperbarui setiap detik.

esp_err_t pzem_read_data(pzem_data_t *out_data)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG,
                        "pzem belum diinisialisasi");
    ESP_RETURN_ON_FALSE(out_data != NULL, ESP_ERR_INVALID_ARG, TAG,
                        "out_data null");

    uint8_t req[PZEM_REQUEST_SIZE] = {0};
    uint8_t resp[PZEM_RESPONSE_SIZE] = {0};

    pzem_build_read_frame(s_cfg.slave_addr, req);
    ESP_RETURN_ON_ERROR(uart_flush_input(s_cfg.uart_num), TAG,
                        "uart_flush_input gagal");

    int written = uart_write_bytes(s_cfg.uart_num, req, sizeof(req));
    ESP_RETURN_ON_FALSE(written == (int)sizeof(req), ESP_FAIL, TAG,
                        "uart_write_bytes tidak lengkap");
    ESP_RETURN_ON_ERROR(uart_wait_tx_done(s_cfg.uart_num, pdMS_TO_TICKS(100)),
                        TAG, "uart_wait_tx_done timeout");

    ESP_RETURN_ON_ERROR(
        pzem_uart_read_exact(s_cfg.uart_num, resp, sizeof(resp),
                             s_cfg.response_timeout_ms),
        TAG,
        "timeout/gagal membaca respons pzem");

    ESP_RETURN_ON_ERROR(pzem_validate_response(resp, s_cfg.slave_addr), TAG,
                        "respons pzem tidak valid");

    uint16_t voltage_raw = pzem_u16_be(resp, 3);
    uint32_t current_raw = ((uint32_t)pzem_u16_be(resp, 7) << 16) |
                            pzem_u16_be(resp, 5);
    uint32_t power_raw = ((uint32_t)pzem_u16_be(resp, 11) << 16) |
                          pzem_u16_be(resp, 9);
    uint32_t energy_raw = ((uint32_t)pzem_u16_be(resp, 15) << 16) |
                           pzem_u16_be(resp, 13);

    out_data->voltage_v = (float)voltage_raw / 10.0f;
    out_data->current_a = (float)current_raw / 1000.0f;
    out_data->power_w = (float)power_raw / 10.0f;
    out_data->energy_wh = (float)energy_raw;
    out_data->frequency_hz = (float)pzem_u16_be(resp, 17) / 10.0f;
    out_data->power_factor = (float)pzem_u16_be(resp, 19) / 100.0f;
    out_data->alarm_status = pzem_u16_be(resp, 21);

    return ESP_OK;
}

Output:
I (12440) app_main: [smart_socket_01] PZEM V=223.4V I=0.182A P=39.6W E=128Wh F=50.0Hz PF=0.97 ALARM=0
I (13442) app_main: [smart_socket_01] PZEM V=223.1V I=0.181A P=39.4W E=128Wh F=50.0Hz PF=0.97 ALARM=0
I (14444) app_main: [smart_socket_01] PZEM V=223.5V I=0.180A P=39.2W E=128Wh F=50.0Hz PF=0.97 ALARM=0

c. Implementasi Enkripsi ASCON-AEAD128

Komponen ascon_crypto mengimplementasikan Ascon-AEAD128 sesuai NIST SP 800-232 dengan ukuran kunci, nonce, dan tag masing-masing 128 bit. Konteks ascon_ctx_t menyimpan active key, previous key untuk rotasi kunci, nonce prefix 64-bit, TX counter 64-bit, last RX counter untuk replay protection, dan status inisialisasi.

typedef struct {
    uint8_t active_key[ASCON_KEY_SIZE];
    uint8_t previous_key[ASCON_KEY_SIZE];
    uint32_t active_key_id;
    uint32_t previous_key_id;
    bool has_previous_key;

    uint64_t nonce_prefix;
    uint64_t tx_counter;
    uint64_t last_rx_counter;

    bool initialized;
} ascon_ctx_t;

Nonce dibentuk dari 8 byte prefix dan 8 byte counter TX dalam representasi big-endian pada level aplikasi. Counter TX dapat diset dari NVS melalui ascon_set_tx_counter agar tetap naik setelah reboot. Pada enkripsi telemetri, firmware membuat nonce baru, mengenkripsi plaintext, dan menghasilkan tag melalui satu fungsi helper.

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

Validasi tag dilakukan dengan ascon_validate_tag_ct agar perbandingan tag bersifat constant time. Pada perintah masuk, counter dari nonce diperiksa melalui ascon_is_fresh_counter sebelum last_rx_counter diperbarui. Jika tag atau counter tidak valid, plaintext dibersihkan dan paket ditolak.

d. Pengiriman Telemetri Terenkripsi melalui MQTT

Data PZEM dibungkus ke telemetry_power_sample_t dan dimasukkan ke circular buffer berkapasitas 180 sampel. Versi terbaru tidak mengirim satu sampel setiap loop, tetapi mengumpulkan 10 sampel per batch. Setiap 10 sampel, firmware membangun JSON plaintext batch, mengenkripsinya dengan ASCON-AEAD128, lalu mempublikasikan envelope ke topik devices/<device_id>/telemetry dengan QoS 1. Jika MQTT belum terhubung, sampel tetap disimpan di buffer dan akan di-flush ketika koneksi tersedia.

telemetry_power_sample_t sample = {
    .voltage_v = data.voltage_v,
    .current_a = data.current_a,
    .power_w = data.power_w,
    .energy_wh = data.energy_wh,
    .frequency_hz = data.frequency_hz,
    .power_factor = data.power_factor,
    .alarm_status = data.alarm_status,
    .ts_ms = sample_ts_ms,
};

telemetry_buffer_push(&sample);
s_batch_count++;

if (s_batch_count >= TELEMETRY_BATCH_SIZE) {
    if (mqtt_app_is_connected()) {
        telemetry_buffer_flush();
    }
    s_batch_count = 0;
    ascon_ctr_nvs_maybe_save(ascon_get_tx_counter(&s_ascon));
}

Plaintext batch yang dienkripsi berisi array samples dengan kunci pendek agar ukuran payload lebih kecil.

{
  "device_id": "smart_socket_01",
  "samples": [
    {"ts": 1710000000000, "v": 223.4, "i": 0.182, "p": 39.6, "e": 128, "f": 50.0, "pf": 0.97, "alarm": 0}
  ]
}

Envelope terenkripsi yang dipublikasikan menggunakan field terbaru enc, kid, ctr, nonce, tag, dan cipher.

{
  "enc": 1,
  "device_id": "smart_socket_01",
  "kid": 1,
  "ctr": 142,
  "nonce": "5a3f9c0100000000000000000000008e",
  "tag": "1f0a7c...3d",
  "cipher": "9c4ad1...e7"
}

e. Penerimaan dan Pemrosesan Perintah Kontrol Manual

Endpoint berlangganan topik devices/<device_id>/command. Seluruh perintah dari backend wajib memakai format terenkripsi baru dengan field enc=1, kid, ctr, nonce, tag, cipher, dan command_id. Payload diparsing oleh telemetry_parse_encrypted_command dan didekripsi oleh telemetry_decrypt_command. Setelah lolos validasi tag dan replay counter, perintah diteruskan ke modul relay atau konfigurasi auto control.

static void mqtt_command_callback(const char *topic, const uint8_t *payload,
                                  size_t payload_len, void *user_ctx)
{
    (void)topic;
    (void)user_ctx;

    char command_id[32] = {0};
    char cmd[64] = {0};
    telemetry_encrypted_command_t enc_cmd = {0};

    if (telemetry_parse_encrypted_command(payload, payload_len, &enc_cmd) != ESP_OK) {
        mqtt_app_publish_ack("cmd-invalid", "error",
                             "format command tidak valid", -1, false);
        return;
    }

    uint32_t key_id = 0;
    uint64_t counter = 0;
    if (telemetry_decrypt_command(&s_ascon, &enc_cmd, cmd, sizeof(cmd),
                                  &key_id, &counter) != ESP_OK) {
        mqtt_app_publish_ack(enc_cmd.command_id, "error",
                             "decrypt command gagal", -1, false);
        return;
    }

    strncpy(command_id, enc_cmd.command_id, sizeof(command_id) - 1U);

    if (strcmp(cmd, "relay_on") == 0 ||
        strcmp(cmd, "relay_off") == 0 ||
        strcmp(cmd, "relay_toggle") == 0) {
        esp_err_t r = (strcmp(cmd, "relay_on") == 0) ? relay_on()
                    : (strcmp(cmd, "relay_off") == 0) ? relay_off()
                    : relay_toggle();
        if (r == ESP_OK && device_state_is_initialized()) {
            device_state_set_mode(DEVICE_WORK_MODE_MANUAL);
        }
    } else if (strcmp(cmd, "mode_auto") == 0) {
        device_state_set_mode(DEVICE_WORK_MODE_AUTOMATIC);
    } else if (strcmp(cmd, "mode_manual") == 0) {
        device_state_set_mode(DEVICE_WORK_MODE_MANUAL);
    } else if (strncmp(cmd, "config_update", 13) == 0) {
        unsigned int new_pir = 0U;
        float new_thr = -1.0f;
        if (sscanf(cmd, "config_update:pir=%u,thr=%f",
                   &new_pir, &new_thr) == 2) {
            auto_control_set_params((uint32_t)new_pir, new_thr);
            autocfg_nvs_save((uint32_t)new_pir, new_thr);
        }
    }

    device_state_set_relay(relay_get_state());
    mqtt_app_publish_relay_status(relay_get_state(), -1, false);
    mqtt_app_publish_ack(command_id, "ok", "command dieksekusi", -1, false);
}

Perintah relay_on, relay_off, dan relay_toggle memaksa mode menjadi MANUAL agar auto control tidak langsung menimpa keputusan pengguna. Perintah mode_auto dan mode_manual digunakan untuk mengganti mode kerja, sedangkan config_update:pir=<detik>,thr=<watt> memperbarui parameter auto control dan menyimpannya ke NVS.

f. Kontrol Otomatis Berbasis Sensor PIR dan Ambang Daya

Komponen auto_control mengevaluasi dua masukan utama, yaitu status gerakan dari PIR HC-SR501 dan nilai daya dari PZEM-004T. Pada versi terbaru evaluasi tetap dijalankan setiap loop agar timer no-motion selalu akurat, tetapi aksi relay hanya diterapkan apabila device sedang berada dalam mode AUTOMATIC. Jika device dalam mode MANUAL, hasil evaluasi tidak mengubah relay.

bool motion = pir_is_motion_detected();
bool relay_is_on = relay_get_state();

device_state_snapshot_t st_now = {0};
bool is_auto_mode = (device_state_get_snapshot(&st_now) == ESP_OK &&
                     st_now.mode == DEVICE_WORK_MODE_AUTOMATIC);

auto_control_decision_t decision = {0};
if (auto_control_evaluate(motion, data.power_w, relay_is_on, &decision) == ESP_OK) {
    esp_err_t relay_ctrl_ret = ESP_OK;

    if (is_auto_mode && decision.action == AUTO_CONTROL_ACTION_RELAY_OFF) {
        relay_ctrl_ret = relay_off();
    } else if (is_auto_mode && decision.action == AUTO_CONTROL_ACTION_RELAY_ON) {
        relay_ctrl_ret = relay_on();
    }

    if (is_auto_mode && decision.action != AUTO_CONTROL_ACTION_NONE) {
        device_state_set_relay(relay_get_state());
        mqtt_app_publish_relay_status(relay_get_state(), -1, false);

        char auto_id[24] = {0};
        snprintf(auto_id, sizeof(auto_id), "auto-%lu",
                 (unsigned long)++s_ack_seq);
        mqtt_app_publish_ack(auto_id,
                             (relay_ctrl_ret == ESP_OK) ? "ok" : "error",
                             decision.reason, -1, false);
    }
}

Setiap aksi otomatis dipublikasikan sebagai relay/status dan ACK dengan command_id berawalan auto-. Dengan demikian dashboard dapat menampilkan riwayat aksi otomatis bersama perintah manual pada satu alur event.

g. Implementasi Backend

Backend terdiri atas REST API, MQTT worker, dan realtime gateway. REST API membaca data dari InfluxDB dan menerima perintah dari dashboard. MQTT worker menangani ingest telemetri, enkripsi perintah dashboard, penerimaan ACK, status relay, serta status konektivitas perangkat. Realtime gateway meneruskan event dashboard melalui WebSocket pada path /ws.

MQTT worker berlangganan topic devices/+/telemetry, dashboard/devices/+/command, devices/+/ack, devices/+/relay/status, dan devices/+/connectivity/status. Untuk telemetri, alur terbaru adalah parse envelope, validasi schema, validasi discovery/registry, cek replay counter ctr, simpan ciphertext mentah ke InfluxDB, dekripsi ASCON-AEAD128, validasi plaintext batch, simpan setiap sampel ke InfluxDB, commit counter, lalu publish status ke dashboard.

async function handleTelemetryMessage({
  topic,
  payloadBuffer,
  influxWriter,
  mqttClient,
  config,
  validators,
  replayGuard,
  registry,
  discovery,
}) {
  const raw = payloadBuffer.toString("utf8");
  const parsed = parseJsonSafe(raw);
  if (!parsed.ok) return;

  const envelope = parsed.data;
  const envelopeCheck = validators.validateEncryptedEnvelope(envelope);
  if (!envelopeCheck.ok) return;

  const replayCheck = replayGuard.check(envelope.device_id, envelope.ctr);
  if (!replayCheck.ok) return;

  await influxWriter.writeEncryptedEnvelope(envelope, topic);

  const plaintextRaw = decryptTelemetryEnvelope(envelope, config.crypto.keyring);
  const telemetry = JSON.parse(plaintextRaw);
  const telemetryCheck = validators.validatePlainTelemetry(telemetry);
  if (!telemetryCheck.ok) return;

  for (const sample of telemetry.samples) {
    await influxWriter.writeTelemetrySample(telemetry.device_id, sample);
  }

  replayGuard.commit(envelope.device_id, envelope.ctr);
  registry.touchSeen(envelope.device_id, true);
}

Perintah kontrol dari dashboard masuk ke topic dashboard/devices/<device_id>/command. Worker memvalidasi payload dashboard, memastikan device terdaftar, mengenkripsi command dengan ASCON-AEAD128, lalu meneruskannya ke topic devices/<device_id>/command. Command counter dikelola di sisi worker agar nonce command juga unik.

encryptedEnvelope = encryptCommandEnvelope({
  keyring: config.crypto.keyring,
  kid: config.crypto.activeKid,
  deviceId: commandPayload.device_id,
  commandId,
  command: commandPayload.command.toLowerCase(),
  counter: commandCounter.next(commandPayload.device_id),
  noncePrefixHex: config.crypto.commandNoncePrefixHex,
});

await mqttPublish(mqttClient, deviceTopic, JSON.stringify(encryptedEnvelope), {
  qos: 1,
  retain: false,
});

h. Implementasi Dashboard Web

Dashboard dikembangkan dengan React, Vite, dan TypeScript pada folder frontend/dashboard. Antarmuka utama menampilkan status perangkat, nilai tegangan, arus, daya, energi, status relay, mode kerja, indikator koneksi, grafik riwayat daya, konfigurasi threshold standby, timeout PIR, dan log event. Data awal dan histori dibaca dari REST API, sedangkan pembaruan real-time diterima melalui WebSocket dari realtime gateway.

Pengguna dapat mengirim perintah relay, memilih mode otomatis atau manual, serta menyimpan konfigurasi PIR timeout dan threshold daya. Perintah dari dashboard dikirim ke backend melalui REST/MQTT dashboard command, kemudian worker mengenkripsi command sebelum diteruskan ke perangkat. Jalur kendali dari dashboard sampai relay tetap dilindungi ASCON-AEAD128, sementara ACK dan status perangkat dikirim balik agar dashboard dapat menampilkan hasil eksekusi hampir real-time.
