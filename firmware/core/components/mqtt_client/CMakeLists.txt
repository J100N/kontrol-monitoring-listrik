idf_component_register(
    SRCS "mqtt_client.c"
    INCLUDE_DIRS "."
    REQUIRES mqtt wifi_manager esp_event
)
