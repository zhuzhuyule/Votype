#[cfg(test)]
mod tests {
    use handy_keys::Hotkey;

    #[test]
    fn check_handy_keys() {
        let _ = "double_command".parse::<Hotkey>();
        let _ = "cmd+cmd".parse::<Hotkey>();
        let _ = "fn+space".parse::<Hotkey>();
        let _ = "fn".parse::<Hotkey>();
    }
}
