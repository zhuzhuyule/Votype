pub(crate) mod ffi_safe;

use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn find_sherpa_tokens(model_dir: &Path) -> Result<PathBuf> {
    let direct = model_dir.join("tokens.txt");
    if direct.exists() {
        return Ok(direct);
    }

    let mut candidates = Vec::new();
    for entry in fs::read_dir(model_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if lower.contains("tokens") && lower.ends_with(".txt") {
            candidates.push(entry.path());
        }
    }
    candidates.sort();
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("Missing tokens file in {:?}", model_dir))
}

pub(crate) fn find_sherpa_onnx(model_dir: &Path, kind: &str, prefer_int8: bool) -> Result<PathBuf> {
    let mut candidates = Vec::new();
    for entry in fs::read_dir(model_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if lower.ends_with(".onnx") && lower.contains(kind) {
            candidates.push((lower, entry.path()));
        }
    }

    if candidates.is_empty() {
        let mut onnx_files = Vec::new();
        for entry in fs::read_dir(model_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase().ends_with(".onnx") {
                onnx_files.push(name);
            }
        }
        onnx_files.sort();
        return Err(anyhow::anyhow!(
            "Missing {} ONNX in {:?}. Found: {:?}",
            kind,
            model_dir,
            onnx_files
        ));
    }

    candidates.sort_by(|a, b| a.0.cmp(&b.0));

    if prefer_int8 {
        if let Some((_, p)) = candidates
            .iter()
            .find(|(name, _)| name.contains("int8") || name.contains(".int8"))
        {
            return Ok(p.clone());
        }
    }

    Ok(candidates[0].1.clone())
}
