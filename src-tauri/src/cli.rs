use crate::transcription_coordinator::TranscriptionCoordinator;
use crate::utils;
use clap::Parser;
use log::{debug, info};
use tauri::{AppHandle, Manager};

#[derive(Parser, Debug, Clone)]
#[command(name = "votype", about = "Votype speech-to-text")]
pub struct CliArgs {
    /// Toggle transcription on/off
    #[arg(long)]
    pub toggle_transcription: bool,

    /// Toggle transcription with post-processing
    #[arg(long)]
    pub toggle_post_process: bool,

    /// Cancel current recording/processing
    #[arg(long)]
    pub cancel: bool,

    /// Start the app hidden (no main window)
    #[arg(long)]
    pub start_hidden: bool,

    /// Show the main window
    #[arg(long)]
    pub show: bool,

    /// Enable debug mode
    #[arg(long)]
    pub debug: bool,

    /// Invoke a skill by ID
    #[arg(long, value_name = "SKILL_ID")]
    pub skill: Option<String>,
}

impl CliArgs {
    /// Parse from a list of string args (used by single-instance callback)
    pub fn try_parse_from_args(args: &[String]) -> Option<Self> {
        Self::try_parse_from(args).ok()
    }

    /// Returns true if any action flag is set (not just startup flags)
    pub fn has_action(&self) -> bool {
        self.toggle_transcription
            || self.toggle_post_process
            || self.cancel
            || self.show
            || self.skill.is_some()
    }
}

/// Handle CLI args from a second instance (single-instance plugin callback)
pub fn handle_cli_args(app: &AppHandle, args: &[String]) {
    let Some(cli_args) = CliArgs::try_parse_from_args(args) else {
        // No valid CLI args, show main window (default behavior)
        let _ = utils::show_or_create_main_window(app, Some("dashboard"));
        return;
    };

    debug!("CLI args: {:?}", cli_args);

    if cli_args.show || !cli_args.has_action() {
        let _ = utils::show_or_create_main_window(app, Some("dashboard"));
    }

    if cli_args.toggle_transcription {
        if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
            info!("CLI: toggle transcription");
            coordinator.send_input("transcribe", "CLI", true, false);
        }
    }

    if cli_args.toggle_post_process {
        if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
            info!("CLI: toggle transcription with post-process");
            coordinator.send_input("transcribe_with_post_process", "CLI", true, false);
        }
    }

    if cli_args.cancel {
        info!("CLI: cancel operation");
        utils::cancel_current_operation(app);
    }

    if let Some(ref skill_id) = cli_args.skill {
        if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
            info!("CLI: invoke skill '{}'", skill_id);
            coordinator.send_input("invoke_skill", "CLI", true, false);
        }
    }

    if cli_args.debug {
        info!("CLI: enabling debug mode");
        crate::CONSOLE_LOG_LEVEL.store(
            log::LevelFilter::Debug as u8,
            std::sync::atomic::Ordering::Relaxed,
        );
    }
}
