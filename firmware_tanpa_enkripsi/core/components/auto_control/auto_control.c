#include "auto_control.h"

#include <string.h>

#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "auto_control";

#define US_PER_SEC 1000000ULL

// Default sesuai requirement: 10 menit no-motion dan threshold 10W.
static const auto_control_config_t AUTO_CONTROL_DEFAULT_CONFIG = {
    .no_motion_off_delay_sec = 600U,
    .power_threshold_w = 10.0f,
    .enable_auto_on = true,
    .enable_auto_off = true,
};

static bool s_initialized = false;
static auto_control_config_t s_cfg = {0};

// Timestamp saat motion terakhir terdeteksi (microsecond).
static int64_t s_last_motion_us = 0;

// State motion sebelumnya untuk mendeteksi reset timer saat ada motion baru.
static bool s_prev_motion = false;

bool auto_control_is_initialized(void)
{
    return s_initialized;
}

const char *auto_control_action_to_string(auto_control_action_t action)
{
    switch (action) {
    case AUTO_CONTROL_ACTION_NONE:
        return "NONE";
    case AUTO_CONTROL_ACTION_RELAY_ON:
        return "RELAY_ON";
    case AUTO_CONTROL_ACTION_RELAY_OFF:
        return "RELAY_OFF";
    default:
        return "UNKNOWN";
    }
}

esp_err_t auto_control_init(const auto_control_config_t *config)
{
    auto_control_config_t cfg = (config != NULL) ? *config : AUTO_CONTROL_DEFAULT_CONFIG;

    ESP_RETURN_ON_FALSE(cfg.no_motion_off_delay_sec > 0U, ESP_ERR_INVALID_ARG, TAG, "delay no-motion harus > 0");
    ESP_RETURN_ON_FALSE(cfg.power_threshold_w >= 0.0f, ESP_ERR_INVALID_ARG, TAG, "power_threshold_w tidak valid");

    s_cfg = cfg;
    s_last_motion_us = esp_timer_get_time();
    s_prev_motion = false;
    s_initialized = true;

    ESP_LOGI(
        TAG,
        "init ok (delay=%lus threshold=%.2fW auto_on=%u auto_off=%u)",
        (unsigned long)s_cfg.no_motion_off_delay_sec,
        s_cfg.power_threshold_w,
        s_cfg.enable_auto_on,
        s_cfg.enable_auto_off);

    return ESP_OK;
}

esp_err_t auto_control_reset_no_motion_timer(void)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "auto_control belum init");

    s_last_motion_us = esp_timer_get_time();
    s_prev_motion = false;
    return ESP_OK;
}

esp_err_t auto_control_set_params(uint32_t no_motion_off_delay_sec, float power_threshold_w)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "auto_control belum init");
    ESP_RETURN_ON_FALSE(no_motion_off_delay_sec > 0U, ESP_ERR_INVALID_ARG, TAG, "delay no-motion harus > 0");
    ESP_RETURN_ON_FALSE(power_threshold_w >= 0.0f, ESP_ERR_INVALID_ARG, TAG, "power_threshold_w tidak valid");

    s_cfg.no_motion_off_delay_sec = no_motion_off_delay_sec;
    s_cfg.power_threshold_w = power_threshold_w;

    ESP_LOGI(
        TAG,
        "param diperbarui (delay=%lus threshold=%.2fW)",
        (unsigned long)s_cfg.no_motion_off_delay_sec,
        s_cfg.power_threshold_w);

    return ESP_OK;
}

esp_err_t auto_control_evaluate(
    bool motion_detected,
    float power_w,
    bool relay_is_on,
    auto_control_decision_t *out_decision)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "auto_control belum init");
    ESP_RETURN_ON_FALSE(out_decision != NULL, ESP_ERR_INVALID_ARG, TAG, "out_decision null");

    memset(out_decision, 0, sizeof(*out_decision));
    out_decision->action = AUTO_CONTROL_ACTION_NONE;
    out_decision->motion_detected = motion_detected;
    out_decision->power_w = power_w;

    int64_t now_us = esp_timer_get_time();

    if (motion_detected) {
        // Jika di tengah hitungan no-motion muncul gerakan sekecil apa pun,
        // timer wajib reset ke 0 dan hitung ulang dari awal.
        if (!s_prev_motion) {
            out_decision->timer_reset = true;
        }

        s_last_motion_us = now_us;
        s_prev_motion = true;
        out_decision->no_motion_elapsed_ms = 0;

        if (s_cfg.enable_auto_on && !relay_is_on) {
            out_decision->action = AUTO_CONTROL_ACTION_RELAY_ON;
            out_decision->reason = "motion_detected_relay_off_auto_on";
            return ESP_OK;
        }

        out_decision->reason = "motion_detected_keep_on";
        return ESP_OK;
    }

    // Tidak ada gerakan pada siklus ini.
    s_prev_motion = false;

    uint64_t no_motion_us = (now_us > s_last_motion_us) ? (uint64_t)(now_us - s_last_motion_us) : 0ULL;
    uint64_t no_motion_sec = no_motion_us / US_PER_SEC;
    out_decision->no_motion_elapsed_ms = no_motion_us / 1000ULL;

    if (!relay_is_on) {
        out_decision->reason = "relay_already_off";
        return ESP_OK;
    }

    if (!s_cfg.enable_auto_off) {
        out_decision->reason = "auto_off_disabled";
        return ESP_OK;
    }

    if (no_motion_sec < (uint64_t)s_cfg.no_motion_off_delay_sec) {
        out_decision->reason = "waiting_no_motion_window";
        return ESP_OK;
    }

    // Auto OFF hanya jika dua syarat terpenuhi sekaligus:
    // 1) benar-benar tidak ada gerakan kontinu selama 10 menit penuh
    // 2) daya berada di bawah threshold.
    if (power_w < s_cfg.power_threshold_w) {
        out_decision->action = AUTO_CONTROL_ACTION_RELAY_OFF;
        out_decision->reason = "no_motion_10m_and_low_power_auto_off";
        return ESP_OK;
    }

    out_decision->reason = "no_motion_met_but_power_still_high";
    return ESP_OK;
}
