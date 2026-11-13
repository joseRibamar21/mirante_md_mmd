//! Escolhe o modo de renderização pelo hardware. A página informa a placa de vídeo (nome do
//! renderizador WebGL; no Windows vem no formato "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 ...)")
//! e aqui juntamos núcleos e RAM.

use serde_json::{json, Value};

pub fn detect(renderer: &str, cores: usize) -> Value {
    let ram_gb = total_ram_gb();
    let (mode, reason) = classify(renderer, cores, ram_gb);
    let gpu = gpu_name(renderer);
    json!({
        "mode": mode, "reason": reason, "gpu": gpu, "cores": cores, "ramGB": ram_gb,
        "label": format!("{gpu} · {cores} núcleos · {ram_gb} GB · {reason}"),
    })
}

fn classify(renderer: &str, cores: usize, ram_gb: u64) -> (&'static str, &'static str) {
    let r = renderer.to_lowercase();
    let has = |keys: &[&str]| keys.iter().any(|k| r.contains(k));
    if r.is_empty() || has(&["llvmpipe", "softpipe", "swrast", "software", "swiftshader", "basic render"]) {
        return ("performance", "sem aceleração de GPU");
    }
    let integrated = has(&[
        "intel", "uhd", "iris", "radeon graphics", "radeon(tm) graphics", "vega 3", "vega 6", "vega 8",
        "vega 10", "vega 11", "renoir", "cezanne", "rembrandt", "phoenix", "raphael", "lucienne",
        "barcelo", "mendocino", "vangogh", "gfx90c", "mali", "adreno", "videocore", "apple", "880m",
        "780m", "760m", "680m", "660m",
    ]);
    let discrete = !integrated
        && has(&["geforce", "nvidia", "quadro", "rtx", "radeon rx", "radeon pro", "navi", "polaris", "radeon vii", "arc a", "arc b", "intel(r) arc"]);
    let ram_ok = ram_gb == 0 || ram_gb >= 8; // 0 = não deu para ler
    if discrete {
        return if cores >= 6 && ram_ok { ("quality", "GPU dedicada") } else { ("balanced", "GPU dedicada, CPU/RAM modestas") };
    }
    if integrated {
        return if cores >= 4 && ram_ok { ("balanced", "GPU integrada") } else { ("performance", "GPU integrada e máquina modesta") };
    }
    if cores >= 4 { ("balanced", "GPU não identificada") } else { ("performance", "máquina modesta") }
}

/// "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)" → "AMD Radeon RX 6700 XT";
/// "AMD Radeon RX 6700 XT (radeonsi, navi22, ...)" → "AMD Radeon RX 6700 XT".
fn gpu_name(renderer: &str) -> String {
    if renderer.is_empty() {
        return "GPU não identificada".into();
    }
    let mut name = renderer.to_string();
    if let Some(inner) = name.strip_prefix("ANGLE (").and_then(|s| s.strip_suffix(')')) {
        name = inner.split(", ").nth(1).unwrap_or(inner).to_string();
        for cut in [" Direct3D", " (0x", " vs_", " OpenGL", " Vulkan"] {
            if let Some(i) = name.find(cut) {
                name.truncate(i);
            }
        }
    } else if let Some(i) = name.find(" (") {
        name.truncate(i);
    }
    name.trim().to_string()
}

#[cfg(target_os = "linux")]
fn total_ram_gb() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("MemTotal")).and_then(|l| l.split_whitespace().nth(1)?.parse::<u64>().ok()))
        .map(|kb| (kb as f64 / 1_048_576.0).round() as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn total_ram_gb() -> u64 {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut st: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    st.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut st) } != 0 {
        (st.ullTotalPhys as f64 / 1_073_741_824.0).round() as u64
    } else {
        0
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
fn total_ram_gb() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nomes_de_gpu() {
        assert_eq!(gpu_name("ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"), "AMD Radeon RX 6700 XT");
        assert_eq!(gpu_name("AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 19.1.1, DRM 3.64)"), "AMD Radeon RX 6700 XT");
        assert_eq!(gpu_name(""), "GPU não identificada");
    }

    #[test]
    fn classificacao() {
        assert_eq!(classify("ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", 12, 32).0, "quality");
        assert_eq!(classify("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", 8, 16).0, "balanced");
        assert_eq!(classify("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", 4, 8).0, "performance");
        assert_eq!(classify("", 8, 16).0, "performance");
    }
}
