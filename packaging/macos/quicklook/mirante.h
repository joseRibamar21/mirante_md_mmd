// Interface C da biblioteca em Rust (src-tauri/preview/src/lib.rs) para a extensão de miniaturas.
#include <stddef.h>
#include <stdint.h>

uint8_t *mirante_thumbnail(const char *path, uint32_t size, uint32_t *out_w, uint32_t *out_h, size_t *out_len);
void mirante_free(uint8_t *ptr, size_t len);
