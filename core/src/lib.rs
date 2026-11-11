//! Shared logic for Tetik Aim, used by both the web server and the desktop app:
//! the list of game modes, validation of submitted scores and a small
//! JSON-file leaderboard store.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// How many entries are kept per mode.
pub const MAX_ENTRIES_PER_MODE: usize = 200;
/// Longest accepted player name, in characters.
pub const MAX_NAME_CHARS: usize = 20;

/// A game mode known to the server. Must match `web/js/modes.js`.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ModeInfo {
    pub id: &'static str,
    pub name: &'static str,
    /// Upper bound on score per second of play, used to reject forged scores.
    pub max_score_per_sec: u32,
    /// Upper bound on hits per second (clicks or tracking ticks).
    pub max_hits_per_sec: u32,
}

pub const MODES: &[ModeInfo] = &[
    m("izgara", "Izgara", 2_500, 12),
    m("hassas", "Hassas Altılı", 2_500, 12),
    m("merkez", "Merkez Flick", 2_500, 12),
    m("mikro", "Mikro Flick", 2_500, 12),
    m("hareketli", "Hareketli Hedefler", 2_500, 12),
    m("kuculen", "Küçülen Hedefler", 3_000, 12),
    m("secim", "Hedef Seçimi", 2_500, 12),
    m("takip", "Pürüzsüz Takip", 2_200, 130),
    m("strafe", "Strafe Takip", 2_200, 130),
    m("kafa", "Kafa Avı", 3_500, 12),
    m("kose", "Köşe Tutma", 3_500, 12),
    m("reaksiyon", "Reaksiyon", 1_000, 2),
];

const fn m(id: &'static str, name: &'static str, s: u32, h: u32) -> ModeInfo {
    ModeInfo {
        id,
        name,
        max_score_per_sec: s,
        max_hits_per_sec: h,
    }
}

pub fn mode(id: &str) -> Option<&'static ModeInfo> {
    MODES.iter().find(|m| m.id == id)
}

/// A score as sent by the client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Submission {
    pub name: String,
    pub mode: String,
    pub score: u32,
    pub hits: u32,
    pub shots: u32,
    /// Seconds actually played.
    pub duration: f64,
    /// Accuracy in percent, 0..=100 (time on target for tracking modes).
    pub accuracy: f64,
    #[serde(default)]
    pub avg_reaction_ms: Option<f64>,
    #[serde(default)]
    pub headshot_pct: Option<f64>,
}

/// A stored leaderboard entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    pub name: String,
    pub mode: String,
    pub score: u32,
    pub accuracy: f64,
    pub hits: u32,
    pub shots: u32,
    pub duration: f64,
    #[serde(default)]
    pub avg_reaction_ms: Option<f64>,
    #[serde(default)]
    pub headshot_pct: Option<f64>,
    /// Unix seconds.
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invalid {
    Name,
    Mode,
    Duration,
    Numbers,
    Implausible,
}

impl std::fmt::Display for Invalid {
    // User-facing (Turkish), shown by the client.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Invalid::Name => "Geçersiz isim (1-20 karakter)",
            Invalid::Mode => "Bilinmeyen mod",
            Invalid::Duration => "Geçersiz süre",
            Invalid::Numbers => "Geçersiz istatistik",
            Invalid::Implausible => "Skor gerçekçi değil",
        })
    }
}

impl std::error::Error for Invalid {}

/// Trims the name and rejects empty, too long or control-character names.
pub fn clean_name(name: &str) -> Result<String, Invalid> {
    let n: String = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let len = n.chars().count();
    if len == 0 || len > MAX_NAME_CHARS || n.chars().any(char::is_control) {
        return Err(Invalid::Name);
    }
    Ok(n)
}

/// Checks a submission and turns it into an entry stamped with `now`.
// shortcut: plausibility bounds only stop crude forgeries; a signed replay
// of the run would be needed to stop a determined cheater.
pub fn validate(s: &Submission, now: u64) -> Result<Entry, Invalid> {
    let name = clean_name(&s.name)?;
    let info = mode(&s.mode).ok_or(Invalid::Mode)?;
    if !s.duration.is_finite() || !(3.0..=600.0).contains(&s.duration) {
        return Err(Invalid::Duration);
    }
    let finite = |v: Option<f64>| v.is_none_or(f64::is_finite);
    if !s.accuracy.is_finite()
        || !(0.0..=100.0).contains(&s.accuracy)
        || !finite(s.avg_reaction_ms)
        || !finite(s.headshot_pct)
        || s.headshot_pct.is_some_and(|h| !(0.0..=100.0).contains(&h))
        || s.avg_reaction_ms.is_some_and(|r| r < 0.0)
        || s.hits > s.shots
    {
        return Err(Invalid::Numbers);
    }
    let secs = s.duration.ceil();
    if f64::from(s.score) > f64::from(info.max_score_per_sec) * secs
        || f64::from(s.hits) > f64::from(info.max_hits_per_sec) * secs
        || s.avg_reaction_ms.is_some_and(|r| r < 80.0 && s.hits > 0)
    {
        return Err(Invalid::Implausible);
    }
    let round1 = |v: f64| (v * 10.0).round() / 10.0;
    Ok(Entry {
        name,
        mode: info.id.to_string(),
        score: s.score,
        accuracy: round1(s.accuracy),
        hits: s.hits,
        shots: s.shots,
        duration: round1(s.duration),
        avg_reaction_ms: s.avg_reaction_ms.map(round1),
        headshot_pct: s.headshot_pct.map(round1),
        at: now,
    })
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Result of a submission: 1-based rank, or `None` if it fell off the board.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubmitResult {
    pub rank: Option<usize>,
    pub total: usize,
    pub best: u32,
}

/// Leaderboards for all modes, best score first.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Board {
    #[serde(default)]
    pub modes: HashMap<String, Vec<Entry>>,
}

impl Board {
    pub fn insert(&mut self, e: Entry) -> SubmitResult {
        let list = self.modes.entry(e.mode.clone()).or_default();
        // Stable: on equal scores the older entry stays ahead.
        let pos = list.partition_point(|x| x.score >= e.score);
        list.insert(pos, e);
        list.truncate(MAX_ENTRIES_PER_MODE);
        SubmitResult {
            rank: (pos < list.len()).then_some(pos + 1),
            total: list.len(),
            best: list.first().map_or(0, |x| x.score),
        }
    }

    pub fn top(&self, mode: &str, limit: usize) -> Vec<Entry> {
        self.modes
            .get(mode)
            .map(|l| l.iter().take(limit).cloned().collect())
            .unwrap_or_default()
    }
}

/// A board persisted as one JSON file.
pub struct Store {
    path: PathBuf,
    board: Board,
}

impl Store {
    /// Loads the file, or starts empty if it does not exist. A corrupt file
    /// is moved aside to `<file>.bad` instead of being overwritten.
    pub fn open(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        let board = match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(b) => b,
                Err(_) => {
                    fs::rename(&path, path.with_extension("json.bad"))?;
                    Board::default()
                }
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => Board::default(),
            Err(e) => return Err(e),
        };
        Ok(Store { path, board })
    }

    pub fn board(&self) -> &Board {
        &self.board
    }

    pub fn submit(&mut self, s: &Submission) -> Result<SubmitResult, Box<dyn std::error::Error>> {
        let entry = validate(s, unix_now())?;
        let res = self.board.insert(entry);
        self.save()?;
        Ok(res)
    }

    /// Writes to a temporary file and renames it, so a crash never leaves a
    /// half-written board.
    pub fn save(&self) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = tmp_path(&self.path);
        fs::write(&tmp, serde_json::to_vec(&self.board)?)?;
        fs::rename(&tmp, &self.path)
    }
}

fn tmp_path(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sub(score: u32) -> Submission {
        Submission {
            name: "  Oyuncu   Bir ".into(),
            mode: "izgara".into(),
            score,
            hits: 100,
            shots: 120,
            duration: 60.0,
            accuracy: 83.33,
            avg_reaction_ms: Some(420.0),
            headshot_pct: None,
        }
    }

    #[test]
    fn validates_and_normalises() {
        let e = validate(&sub(50_000), 7).unwrap();
        assert_eq!(e.name, "Oyuncu Bir");
        assert_eq!(e.accuracy, 83.3);
        assert_eq!(e.at, 7);
    }

    #[test]
    fn rejects_bad_input() {
        let mut s = sub(1);
        s.name = "   ".into();
        assert_eq!(validate(&s, 0), Err(Invalid::Name));
        s.name = "a".repeat(21);
        assert_eq!(validate(&s, 0), Err(Invalid::Name));
        s.name = "ğüşıöç İĞÜŞÖÇ abcdef".into(); // 20 chars incl. spaces
        assert!(validate(&s, 0).is_ok());
        s.mode = "yok".into();
        assert_eq!(validate(&s, 0), Err(Invalid::Mode));
        let mut s = sub(1);
        s.hits = 200;
        assert_eq!(validate(&s, 0), Err(Invalid::Numbers));
        let mut s = sub(1);
        s.accuracy = f64::NAN;
        assert_eq!(validate(&s, 0), Err(Invalid::Numbers));
        let mut s = sub(1);
        s.duration = 1.0;
        assert_eq!(validate(&s, 0), Err(Invalid::Duration));
        assert_eq!(validate(&sub(10_000_000), 0), Err(Invalid::Implausible));
        let mut s = sub(1);
        s.avg_reaction_ms = Some(20.0);
        assert_eq!(validate(&s, 0), Err(Invalid::Implausible));
    }

    #[test]
    fn board_orders_and_truncates() {
        let mut b = Board::default();
        let e = |score| validate(&sub(score), 0).unwrap();
        assert_eq!(b.insert(e(10)).rank, Some(1));
        assert_eq!(b.insert(e(30)).rank, Some(1));
        assert_eq!(b.insert(e(20)).rank, Some(2));
        assert_eq!(b.insert(e(20)).rank, Some(3));
        let scores: Vec<u32> = b.top("izgara", 10).iter().map(|x| x.score).collect();
        assert_eq!(scores, [30, 20, 20, 10]);
        for _ in 0..MAX_ENTRIES_PER_MODE {
            b.insert(e(100));
        }
        let r = b.insert(e(1));
        assert_eq!(r.rank, None);
        assert_eq!(r.total, MAX_ENTRIES_PER_MODE);
        assert_eq!(r.best, 100);
        assert!(b.top("kafa", 5).is_empty());
    }

    #[test]
    fn store_roundtrip_and_corrupt_file() {
        let dir = std::env::temp_dir().join(format!("tetik-test-{}", std::process::id()));
        let path = dir.join("scores.json");
        let _ = fs::remove_dir_all(&dir);
        let mut st = Store::open(&path).unwrap();
        st.submit(&sub(1234)).unwrap();
        let st2 = Store::open(&path).unwrap();
        assert_eq!(st2.board().top("izgara", 1)[0].score, 1234);
        fs::write(&path, b"{not json").unwrap();
        let st3 = Store::open(&path).unwrap();
        assert!(st3.board().modes.is_empty());
        assert!(dir.join("scores.json.bad").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
