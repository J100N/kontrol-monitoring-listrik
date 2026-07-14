idf_component_register(
    SRCS "time_sync.c"
    INCLUDE_DIRS "."
    REQUIRES lwip esp_timer freertos esp_system esp_common
)
