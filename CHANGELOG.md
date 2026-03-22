# Changelog

## v2.9.0

### Major
- Task lifecycle overhaul - new statuses (planning/pending_approval/working/done/closed), transition enforcement, simplified actions (Accept/Improve/Hold/Cancel)
- Agent activity indicator - global per-agent active status via API + WebSocket
- Notification system - bell in top bar, dropdown, browser notifications, sound alerts, settings
- Agent Performance Dashboard - per-agent stats, team overview, revision rates

### Features
- Vercel CLI skill added to catalog with npm global install fallback
- Skills UI - curated vs user-installed separation
- Onboarding wizard skip button
- Dashboard tabs reorganized to match task statuses
- Done to closed auto-lifecycle (2-day timer)
- Remote Access integration (Claude Remote Control)
- Monochrome SVG icon system (replaced all colored emoji)

### Fixes
- Accept confirmation removed (immediate action)
- Autopilot toggle confirmation added
- Notification dropdown overflow clipping fixed
- Notification bell moved to top bar (Command Center + Dashboard)
- Old status references cleaned across entire codebase and templates
