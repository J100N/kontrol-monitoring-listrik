#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_event_base.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    WIFI_MANAGER_STATE_IDLE = 0,
    WIFI_MANAGER_STATE_CONNECTING,
    WIFI_MANAGER_STATE_CONNECTED,
    WIFI_MANAGER_STATE_FAILED
} wifi_manager_state_t;

typedef enum {
    WIFI_MANAGER_EVENT_CONNECTING = 0,
    WIFI_MANAGER_EVENT_CONNECTED,
    WIFI_MANAGER_EVENT_DISCONNECTED,
    WIFI_MANAGER_EVENT_GOT_IP,
    WIFI_MANAGER_EVENT_CONNECT_FAILED
} wifi_manager_event_t;

typedef struct {
    const char *ssid;
    const char *password;
    uint8_t max_retry;
} wifi_manager_config_t;

typedef void (*wifi_manager_event_cb_t)(
    wifi_manager_event_t event,
    void *event_data,
    void *user_ctx);

esp_err_t wifi_manager_init(
    const wifi_manager_config_t *config,
    wifi_manager_event_cb_t event_cb,
    void *user_ctx);

esp_err_t wifi_manager_start(void);

esp_err_t wifi_manager_stop(void);

esp_err_t wifi_manager_connect(void);

bool wifi_manager_is_connected(void);

wifi_manager_state_t wifi_manager_get_state(void);

esp_err_t wifi_manager_wait_until_connected(uint32_t timeout_ms);

const char *wifi_manager_state_to_string(wifi_manager_state_t state);

#ifdef __cplusplus
}
#endif

#endif
