use std::sync::{Arc, Mutex};
use tokio::task::AbortHandle;

#[derive(Clone)]
pub struct PostProcessingManager {
    current_task: Arc<Mutex<Option<AbortHandle>>>,
}

impl PostProcessingManager {
    pub fn new() -> Self {
        Self {
            current_task: Arc::new(Mutex::new(None)),
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
}
