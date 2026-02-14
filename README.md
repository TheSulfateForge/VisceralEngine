<div align="center">

![VRE Logo](https://raw.githubusercontent.com/TheSulfateForge/VisceralEngine/refs/heads/main/public/logo512.png)

# Visceral Realism Engine

### *An Uncompromising Sandbox Simulation*

**Grounded Realism • Mature Themes • Biological Consequences**

[![Live Demo](https://img.shields.io/badge/🎮_Play_Now-Live_Demo-critical?style=for-the-badge)](https://thesulfateforge.github.io/VisceralEngine/)
[![PWA](https://img.shields.io/badge/📱_PWA-Installable-blue?style=for-the-badge)](https://thesulfateforge.github.io/VisceralEngine/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

</div>

## 🎯 What is VRE?

**Visceral Realism Engine** is an AI-powered sandbox simulation game master that doesn't pull punches. Every action has weight, every decision carries consequences, and the world responds with brutal honesty.

Unlike traditional RPG systems that abstract away the messy reality of existence, VRE simulates:
- 🩸 **Realistic injury mechanics** with anatomical precision
- ⏱️ **Persistent time and biological needs** (hunger, fatigue, trauma)
- 🧠 **Psychological consequences** of violence and survival
- 🌍 **Dynamic world simulation** that reacts to your choices
- 💀 **Permanent consequences** - death is final, scars are real

## ✨ Features

### 🎭 AI Game Master
- Powered by **Google's Gemini AI** for dynamic storytelling
- Contextually aware responses that remember your entire journey
- Adaptive difficulty based on your survival tactics

### 🎮 Progressive Web App (PWA)
- **Install as native app** on desktop and mobile
- **Offline gameplay** with service worker caching
- **Cross-platform** - play anywhere, anytime

### 💾 Local-First Privacy
- **Your data stays on your device** - all API keys stored locally
- **No server-side tracking** or data collection
- **Full control** over your game sessions and data

### 🔧 Advanced Systems
- **Detailed character tracking** with persistent stats
- **Environmental simulation** with time progression
- **Injury and trauma modeling** with recovery mechanics
- **Resource management** for survival scenarios
- **Multi-character campaigns** with save/load functionality

## 🚀 Getting Started

### 🌐 Play Online (Easiest)

Just visit **[thesulfateforge.github.io/VisceralEngine](https://thesulfateforge.github.io/VisceralEngine/)** and start playing!

You can also **install it as a PWA** for offline access:
- **Desktop**: Click the install icon in your browser's address bar
- **Mobile**: Add to home screen from your browser menu

### 🔑 Required: Google AI Studio API Key

VRE requires a **Google AI Studio API key** to function. Don't worry - it's completely free!

1. **Get your API key**: Visit [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. **Sign in** with your Google account
3. **Create an API key** (takes 30 seconds)
4. **Paste it into VRE** when prompted

> 🔒 **Privacy Note**: Your API key is stored **locally on your device only**. It never leaves your browser and is not transmitted to any server except Google's AI services.

### 💻 Run Locally (For Developers)

**Prerequisites:**
- Node.js 18+ and npm

**Installation:**

```bash
# Clone the repository
git clone https://github.com/TheSulfateForge/VisceralEngine.git
cd VisceralEngine

# Install dependencies
npm install

# Create environment file
echo "GEMINI_API_KEY=your_api_key_here" > .env.local

# Run development server
npm run dev
```

The app will be available at `http://localhost:3000`

**Build for production:**
```bash
npm run build
npm run preview
```

## 🎮 How to Play

1. **Launch the game** and enter your Google AI Studio API key
2. **Create your character** or load a previous save
3. **Describe your actions** in natural language
4. **Experience the consequences** - VRE simulates realistic outcomes
5. **Survive, adapt, and make meaningful choices**

> ⚠️ **Content Warning**: VRE simulates mature themes including violence, injury, trauma, and survival scenarios. Intended for mature audiences.

## 🛠️ Tech Stack

- **Frontend**: React 19 + TypeScript
- **Build Tool**: Vite 7
- **PWA**: VitePWA plugin with Workbox
- **AI**: Google Gemini AI (gemini-2.5-flash)
- **Storage**: IndexedDB for local persistence
- **Styling**: Tailwind CSS
- **Deployment**: GitHub Pages

## 📱 Browser Support

VRE works best on modern browsers:
- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Mobile browsers (iOS Safari, Chrome Android)

PWA installation supported on all major platforms.

## 🤝 Contributing

Contributions are welcome! This project is in active development.

**Ideas for contribution:**
- Additional injury/medical mechanics
- New environmental systems
- UI/UX improvements
- Bug fixes and optimizations
- Documentation improvements

Please open an issue first to discuss major changes.

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Google AI Studio](https://ai.studio/)
- Powered by [Gemini AI](https://deepmind.google/technologies/gemini/)
- Generated from [google-gemini/aistudio-repository-template](https://github.com/google-gemini/aistudio-repository-template)

## 📞 Support & Contact

- 🐛 **Bug Reports**: [Open an issue](https://github.com/TheSulfateForge/VisceralEngine/issues)
- 💡 **Feature Requests**: [Start a discussion](https://github.com/TheSulfateForge/VisceralEngine/discussions)
- 📧 **Contact**: Create an issue or discussion

---

<div align="center">

**[🎮 Play Now](https://thesulfateforge.github.io/VisceralEngine/)** • **[📖 Documentation](#)** • **[🐛 Report Bug](https://github.com/TheSulfateForge/VisceralEngine/issues)**

*Built with ❤️ and powered by AI*

</div>