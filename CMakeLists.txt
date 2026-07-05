cmake_minimum_required(VERSION 3.16)

set(DEVICE_VARIANT "smart_socket" CACHE STRING "Pilih profile device pada firmware/devices")
set_property(CACHE DEVICE_VARIANT PROPERTY STRINGS smart_socket)

set(SDKCONFIG_DEFAULTS "${CMAKE_SOURCE_DIR}/firmware/core/sdkconfig.defaults")
set(DEVICE_COMPONENT_DIR "${CMAKE_SOURCE_DIR}/firmware/devices/${DEVICE_VARIANT}")

if(NOT EXISTS "${DEVICE_COMPONENT_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "CMakeLists.txt tidak ditemukan untuk DEVICE_VARIANT='${DEVICE_VARIANT}' di ${DEVICE_COMPONENT_DIR}")
endif()

set(EXTRA_COMPONENT_DIRS
	"${CMAKE_SOURCE_DIR}/firmware/core/components"
	"${DEVICE_COMPONENT_DIR}"
)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(kontrol_monitoring_listrik_fw)
