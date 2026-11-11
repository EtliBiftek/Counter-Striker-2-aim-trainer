//! Tetik Aim app (Windows, Linux, macOS, Android): the web game in a native
//! window, with the leaderboard stored locally in the app data directory.

use std::sync::Mutex;
use tauri::Manager;
use tetik_core::{Entry, Store, Submission, SubmitResult};

struct Local(Mutex<Store>);

#[tauri::command]
fn submit_score(state: tauri::State<'_, Local>, entry: Submission) -> Result<SubmitResult, String> {
    let mut store = state.0.lock().map_err(|e| e.to_string())?;
    store.submit(&entry).map_err(|e| e.to_string())
}

#[tauri::command]
fn leaderboard(
    state: tauri::State<'_, Local>,
    mode: String,
    limit: usize,
) -> Result<Vec<Entry>, String> {
    let store = state.0.lock().map_err(|e| e.to_string())?;
    Ok(store.board().top(&mode, limit.min(100)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = Store::open(dir.join("scores.json"))?;
            app.manage(Local(Mutex::new(store)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![submit_score, leaderboard])
        .run(tauri::generate_context!())
        .expect("error while running Tetik Aim");
}
