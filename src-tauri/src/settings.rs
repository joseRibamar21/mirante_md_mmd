//! Preferências em <config>/mirante/settings.json — o mesmo arquivo da versão GTK, então quem
//! atualiza mantém tema, ajustes por arquivo e recentes. (<config> = ~/.config no Linux,
//! %APPDATA% no Windows.)

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

const GLOBAL_KEYS: &[&str] = &["glass", "autoHideDock", "editorWidth", "renderMode"];
const RECENT_MAX: usize = 8;
const FILES_MAX: usize = 300;

pub struct Settings {
    file: PathBuf,
    pub data: Value,
}

impl Settings {
    pub fn load(config_dir: &Path) -> Self {
        let file = config_dir.join("mirante").join("settings.json");
        let mut data = json!({"theme": null, "defaults": {}, "files": {}, "recent": []});
        if let Ok(text) = fs::read_to_string(&file) {
            if let Ok(Value::Object(loaded)) = serde_json::from_str::<Value>(&text) {
                for (k, v) in loaded {
                    data[k] = v;
                }
            }
        }
        Settings { file, data }
    }

    pub fn save(&self) {
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = self.file.with_extension("json.tmp");
        if let Ok(text) = serde_json::to_string_pretty(&self.data) {
            if fs::write(&tmp, text).is_ok() {
                let _ = fs::rename(&tmp, &self.file);
            }
        }
    }

    fn obj(&mut self, key: &str) -> &mut Map<String, Value> {
        if !self.data[key].is_object() {
            self.data[key] = json!({});
        }
        self.data[key].as_object_mut().unwrap()
    }

    /// Padrões + ajustes deste arquivo; as chaves globais valem para todos os arquivos.
    pub fn prefs_for(&self, path: &str) -> Value {
        let defaults = self.data["defaults"].as_object().cloned().unwrap_or_default();
        let mut p = defaults.clone();
        if let Some(Value::Object(f)) = self.data["files"].get(path) {
            for (k, v) in f {
                p.insert(k.clone(), v.clone());
            }
        }
        for k in GLOBAL_KEYS {
            if let Some(v) = defaults.get(*k) {
                p.insert((*k).to_string(), v.clone());
            }
        }
        Value::Object(p)
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.data["defaults"].get(key)
    }

    pub fn set_prefs(&mut self, path: Option<&str>, prefs: &Value) {
        self.data["defaults"] = prefs.clone();
        if let Some(path) = path {
            let per_file: Map<String, Value> = prefs
                .as_object()
                .map(|m| m.iter().filter(|(k, _)| !GLOBAL_KEYS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default();
            let files = self.obj("files");
            files.remove(path);
            files.insert(path.to_string(), Value::Object(per_file));
            while files.len() > FILES_MAX {
                let first = files.keys().next().cloned().unwrap();
                files.remove(&first);
            }
        }
        self.save();
    }

    pub fn theme(&self) -> Option<&str> {
        self.data["theme"].as_str()
    }

    pub fn set_theme(&mut self, dark: bool) {
        self.data["theme"] = json!(if dark { "dark" } else { "light" });
        self.save();
    }

    /// Últimos arquivos abertos, do mais novo para o mais antigo: só nome e caminho.
    pub fn recent(&self) -> Vec<(String, String)> {
        self.data["recent"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|r| {
                        let path = r.get("path")?.as_str()?.to_string();
                        let name = r.get("name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| file_name(&path));
                        Some((name, path))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn add_recent(&mut self, path: &str) {
        let mut items: Vec<Value> = self
            .recent()
            .into_iter()
            .filter(|(_, p)| p != path)
            .map(|(name, path)| json!({"name": name, "path": path}))
            .collect();
        items.insert(0, json!({"name": file_name(path), "path": path}));
        items.truncate(RECENT_MAX);
        self.data["recent"] = Value::Array(items);
        self.save();
    }

    pub fn hardware(&self) -> Option<&Value> {
        self.data.get("hardware").filter(|v| v.is_object())
    }

    pub fn set_hardware(&mut self, hw: Value) {
        self.data["hardware"] = hw;
        self.save();
    }
}

pub fn file_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}
