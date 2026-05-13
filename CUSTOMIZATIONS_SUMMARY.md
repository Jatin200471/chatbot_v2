# Chatwoot Customizations Summary
## Changes Made vs Original Chatwoot

---

## 📋 Overview

This is a **custom fork of Chatwoot** with **chat widget enhancements**. All custom code is isolated in the `custom/` folder (never modifying upstream files).

---

## 🎯 Key Customizations by Category

### 1. **BACKEND CUSTOMIZATIONS** (`custom/backend/`)

#### A. Database Migration
- **File:** `custom/backend/migrations/20260408000001_add_elevenlabs_to_channel_web_widgets.rb`
- **Change:** Extended channel configuration
- **Purpose:** Store custom widget settings

#### B. Models
- **File:** `custom/backend/models/web_widget.rb`
- **Changes:**
  - Customized widget configuration

#### C. Controllers
- **File:** `custom/backend/controllers/conversations_controller.rb`
- **Changes:** 
  - Modified conversation handling for custom chat flows
  - Token management on chat exit
  - New contact creation logic

- **File:** `custom/backend/controllers/inboxes_controller.rb`
- **Changes:** 
  - Custom inbox response handling
  - Integration with chat workflows

#### D. API Response Views
- **File:** `custom/backend/views/_inbox.json.jbuilder`
- **Change:** Modified JSON response structure for inbox data

- **File:** `custom/backend/views/show.html.erb`
- **Change:** Custom widget embedding template

#### E. Helper Files
- **File:** `custom/backend/controllers/concerns/website_token_helper.rb`
- **Change:** Custom token generation/validation for web widgets

---

### 2. **WIDGET FRONTEND CUSTOMIZATIONS** (`custom/widget/`)

#### A. Chat Input Enhancement
- **File:** `custom/widget/components/ChatInputWrap.vue`
- **Changes:**
  - Enhanced input handling
  - Improved component structure

#### B. Core Components Modified
- **File:** `custom/widget/components/Form.vue`
  - Enhanced form validation
  - Chat flow improvements

- **File:** `custom/widget/components/HeaderActions.vue`
  - Exit chat button improvements
  - Conversation exit handling
  - Session reset logic

#### C. API Integrations
- **File:** `custom/widget/api/contacts.js`
- **New Logic:**
  - Auth token management
  - Token clearing on exit
  - New contact creation when no token exists
  - Name retention settings

- **File:** `custom/widget/api/conversation.js`
- **Changes:**
  - Custom conversation creation
  - Message sending
  - Conversation metadata handling

#### D. State Management
- **File:** `custom/widget/store/modules/appConfig.js`
  - Widget behavior settings
  - Application configuration

- **File:** `custom/widget/store/modules/contacts.js`
  - Contact data persistence
  - Auth token storage

- **File:** `custom/widget/store/modules/conversation/actions.js`
  - Conversation actions for chat
  - Exit handling
  - New chat initialization

#### E. Utilities
- **File:** `custom/widget/helpers/axios.js`
- **Change:** Custom axios instance with auth token headers

- **File:** `custom/widget/mixins/configMixin.js`
- **Change:** Shared configuration mixing for components

#### G. Views
- **File:** `custom/widget/views/App.vue`
  - Main widget app

- **File:** `custom/widget/views/Home.vue`
  - Home page layout

- **File:** `custom/widget/views/PreChatForm.vue`
  - Pre-chat form customization

#### H. Internationalization
- **File:** `custom/widget/i18n/en.json`
- **Changes:** 
  - Custom UI labels
  - Multi-language support prep

---

### 3. **DASHBOARD CUSTOMIZATIONS** (`custom/dashboard/`)

- **File:** `custom/dashboard/ConfigurationPage.vue`
- **Changes:**
  - Widget customization interface
  - Settings management

---

### 4. **BUILD & DEPLOYMENT** (`custom-widget/`, `Dockerfile`)

#### A. Custom Widget Build
- **File:** `custom-widget/package.json`
- **Changes:** 
  - Vite build configuration
  - Custom build scripts

- **File:** `custom-widget/patches/configMixin.js`
- **Purpose:** Patch mixin for feature compatibility

- **File:** `custom-widget/components/HeaderActions.vue`, `.backup`
- **Changes:** Component enhancements

#### B. Docker Configuration
- **File:** `Dockerfile`
- **Key Changes:**
  - Multi-stage Node.js build for widget
  - Custom environment variables
  - Asset compilation with Vite
  - Increased build memory limits
  - Pnpm support

---

### 5. **CONFIGURATION & DOCUMENTATION**

#### Agent Control Files
- **`.antigravity/memory.md`** - Project context & patterns
- **`.antigravity/RULES.md`** - Coding standards (stay in `custom/`)
- **`.antigravity/PLAN.md`** - Current work outline
- **`.antigravity/TASKS.md`** - Task tracking

#### Environment
- **`.env.example`** - Example env vars (deleted)
- **`.gitignore`** - Git ignore rules (modified for custom/)

#### Documentation
- **`CLAUDE.md`** - AI assistant context
- **`README.md`** - Setup & usage guide

---

## 🔄 How Custom Code Is Isolated

All customizations follow the **`custom/` directory pattern** to ensure:

✅ **Non-breaking upgrades** - Original Chatwoot files never modified
✅ **Easy maintenance** - All changes in one place
✅ **Git tracking** - Simple to see what's been added
✅ **Reusability** - Can apply to new Chatwoot versions

**Golden Rule:** Never edit upstream Chatwoot files outside `custom/` folder.

---

## 📊 File Summary

| Category | Files Changed | New Files |
|----------|---------------|-----------|
| Backend | 6 | 1 migration |
| Widget Frontend | 15 | - |
| Dashboard | 1 | - |
| Build/Config | 4 | - |
| **Total** | **26** | **1** |

---

## 🔧 Key Features Added

| Feature | Original | Custom |
|---------|----------|--------|
| Token Management | Standard | Enhanced |
| Session Handling | Standard | Improved |
| Exit Chat Logic | Standard | Custom reset |
| Chat Widget | Standard | Enhanced |

---

## 🚀 Deployment Commands

```bash
# Start local stack
docker compose up -d

# Dashboard
http://localhost:3000

# Widget endpoint
/custom-widget
```

---

## 📝 Recent Fixes (Last 20 Days)

| Category | Changes |
|----------|---------|
| Button Errors | 30+ fixes for naming conflicts |
| Chat Exit | Token clearing, session reset |
| Auth Token | Proper cleanup on exit |
| Docker Build | Memory limits, pnpm integration |
| Structure | Form/component organization |

---

## ⚠️ Critical Notes

1. **No Upstream Edits** - All changes must stay in `custom/` folder
2. **Git Conflicts** - Pulling new Chatwoot versions is safe (separate folder)

---

## 🎯 Summary

**This is NOT a fork, it's an overlay.** Original Chatwoot code untouched. Custom code adds:
- 🛠️ **Widget enhancements** (UI, auth, session)
- 📊 **Configuration management** (settings)

**Result:** Production-ready Chatwoot with custom widget in one Docker container.
