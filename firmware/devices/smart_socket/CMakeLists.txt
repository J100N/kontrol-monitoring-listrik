idf_component_register(
    SRCS "app_main.c"
    INCLUDE_DIRS "."
    REQUIRES wifi_manager pzem004t mqtt_client relay_sla5vdcslc pir_hcsr501 auto_control device_state oled_ssd1306 telemetry ascon_crypto time_sync nvs_flash esp_hw_support
)
