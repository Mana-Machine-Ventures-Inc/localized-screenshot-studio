// Localized Screenshot Studio - Tauri desktop shell.
//
// Architecture:
//  - The heavy lifting (project reader, AI generation, Playwright capture,
//    compositing, App Store Connect uploads) lives in the Node "engine"
//    (../engine) exposed as a local HTTP API on 127.0.0.1:8787.
//  - In development, `beforeDevCommand` runs `npm run dev`, which starts both
//    the engine and the Vite UI; the webview loads the Vite dev server and the
//    Vite proxy forwards /api and /render to the engine.
//  - In a packaged build, the engine is started as a sidecar (best effort here)
//    and the bundled UI talks to it directly.

#[cfg(not(debug_assertions))]
fn spawn_engine(app: &tauri::App) {
    use tauri::Manager;
    let Ok(resource_dir) = app.path().resource_dir() else {
        eprintln!("[shell] could not resolve resource dir; engine not started");
        return;
    };
    let engine_entry = resource_dir.join("engine").join("src").join("index.ts");
    match std::process::Command::new("node")
        .arg("--import")
        .arg("tsx")
        .arg(engine_entry)
        .spawn()
    {
        Ok(_) => println!("[shell] engine sidecar started"),
        Err(e) => eprintln!("[shell] failed to start engine sidecar: {e}"),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            spawn_engine(_app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
