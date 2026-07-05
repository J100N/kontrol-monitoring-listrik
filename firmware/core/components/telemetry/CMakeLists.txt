idf_component_register(
    SRCS "telemetry.c"
    INCLUDE_DIRS "."
    REQUIRES ascon_crypto esp_timer
)
