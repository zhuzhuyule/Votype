use std::sync::{Arc, Mutex};
use tokio::task::AbortHandle;

#[derive(Clone)]
pub struct PostProcessingManager {
    current_task: Arc<Mutex<Option<AbortHandle>>>,
    pipeline_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
}

impl PostProcessingManager {
    pub fn new() -> Self {
        Self {
            current_task: Arc::new(Mutex::new(None)),
            pipeline_task: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_current_task(&self, handle: AbortHandle) {
        let mut task = self.current_task.lock().unwrap();
        if let Some(old_handle) = task.take() {
            old_handle.abort();
        }
        *task = Some(handle);
    }

    pub fn cancel_current_task(&self) {
        let mut task = self.current_task.lock().unwrap();
        if let Some(handle) = task.take() {
            handle.abort();
        }
    }

    pub fn set_pipeline_task(&self, handle: tauri::async_runtime::JoinHandle<()>) {
        let mut task = self.pipeline_task.lock().unwrap();
        if let Some(old_handle) = task.take() {
            old_handle.abort();
        }
        *task = Some(handle);
    }

    pub fn cancel_pipeline(&self) {
        // Abort the outer pipeline task
        {
            let mut task = self.pipeline_task.lock().unwrap();
            if let Some(handle) = task.take() {
                handle.abort();
            }
        }
        // Also abort the inner post-processing task
        self.cancel_current_task();
    }
}
