# Top-up Game Website — Update V4

## 🛑 សំខាន់បំផុត — ដោះស្រាយបញ្ហា Deploy ជាមុនសិន!

យើងសម្គាល់ឃើញថា `wanfunzy.com/topup` បង្ហាញ **404** ខណៈពេល `wanfunzy.com` (homepage) ដំណើរការធម្មតា។ នេះមានន័យថា **code ថ្មីពីលើកមុនមិនទាន់ deploy ដោយជោគជ័យទេ**។ មុននឹង copy file V4 ទាំងនេះចូល សូមជួយផ្ទៀងផ្ទាត់ ៣ ចំណុចនេះសិន៖

1. **GitHub Desktop → History tab** — មើល commit ចុងក្រោយ មានសរសេរអ្វី និងពេលណា?
2. **ប៊ូតុង "Push origin"** — បើនៅតែឃើញសរសេរថា "Push origin" ឬមាន number (ឧ. "Push origin 1") នោះមានន័យថា **commit មិនទាន់ត្រូវ push ទៅ GitHub.com ទេ** — ត្រូវចុចប៊ូតុងនេះ
3. **Railway Dashboard → Deployments tab** — deployment ចុងក្រោយ status ជា **Success** (✅) ឬ **Failed** (❌)?

ប្រសិនបើ Railway deployment **Failed**៖ ចុចលើ deployment នោះ → មើល **"Build Logs"** ឬ **"Deploy Logs"** → ថត screenshot ផ្ញើមកឲ្យខ្ញុំ ដើម្បីខ្ញុំជួយរក error ច្បាស់លាស់។

## អ្វីដែលថ្មីក្នុង V4 (បន្ថែមលើ V3)

**Admin Feature ថ្មី — Upload Background Photo លើ Package Card**

ក្នុង Admin Dashboard → "កញ្ចប់តាម Game" → ក្រោម emoji editor ឥឡូវមាន upload box ថ្មី៖

```
Background រូបភាព សម្រាប់ Package Card (ស្រេចចិត្ត)
[រូបភាព preview]  [Upload Background]
```

- **បើ Upload រូបភាព**: រូបនោះនឹងបង្ហាញជា background ពីក្រោយ card នីមួយៗសម្រាប់ game នោះ (ជំនួស emoji glow)
- **បើមិន Upload**: នៅតែប្រើ Emoji glow ដូចមុន (V3) — មិនបាត់អ្វីទេ
- អាច **លុបរូបភាព** ដើម្បីត្រឡប់ទៅ Emoji glow វិញ

## File ដែលត្រូវ Copy ដាក់ជំនួស (ទាំងអស់ជា "ជំនួស")

| File | ដាក់នៅ |
|---|---|
| `server.js` | Root project folder |
| `db.js` | Root project folder |
| `styles.css` | `public\` |
| `home.js` | `views\` |
| `admin-dashboard.js` | `views\` |
| `topup-select.js` | `views\` |
| `topup-package.js` | `views\` |
| `topup-checkout.js` | `views\` |

## ជំហានដាក់ឱ្យដំណើរការ

1. **ដោះស្រាយបញ្ហា deploy ជាមុនសិន** (មើលផ្នែកខាងលើ)
2. Extract zip → Copy-paste ជំនួស files ទាំង ៨ ខាងលើ
3. GitHub Desktop → Commit (`Add card background photo upload feature`) → **ត្រូវប្រាកដថាបាន Push origin!**
4. រង់ចាំ Railway deploy ២-៣ នាទី → ពិនិត្យ Deployments tab ថា Success
5. សាកល្បង៖ `wanfunzy.com/topup` ត្រូវរត់ដោយជោគជ័យ (មិនមែន 404 ទេ)
