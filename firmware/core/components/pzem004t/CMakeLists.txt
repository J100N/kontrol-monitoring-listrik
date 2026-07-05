idf_component_register(
    SRCS "pzem.c"
    INCLUDE_DIRS "."
    REQUIRES esp_driver_uart esp_timer
)
