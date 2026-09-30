# Install JobReceipts (Gmail account, about 20 minutes)

Do this on a computer. You only paste two files. Everything runs in your own Google
account; nobody else, Claude included, gets access to it.

Files you need (open each link, select all, copy):
- **Code.gs**: `receipts/dist/install/Code.gs`
- **Index.html**: `receipts/dist/install/Index.html`

## 1. Get your AI key (5 min)
1. Go to **console.anthropic.com** and sign up (you can use jobreceiptsbtr@gmail.com).
2. **Billing**: add a card and buy a small amount of credit ($10 lasts a long time; a receipt costs a few cents to read).
3. **API keys** → **Create key** → name it "JobReceipts" → copy the key (starts with `sk-ant-`). Keep it private.

## 2. Make the project (5 min)
1. Sign in to Google as **jobreceiptsbtr@gmail.com** and go to **script.google.com**.
2. Click **New project**. Click "Untitled project" at the top and name it **JobReceipts**.
3. In **Code.gs**, delete everything, then paste the whole **Code.gs** file.
4. At the very top, fill in the three lines between the quotes:
   - `ANTHROPIC_API_KEY`: the key from step 1
   - `COMPANY_NAME`: e.g. BTR Contracting
   - `COMPANY_ADDRESS`: e.g. 9350 G Ct, Omaha, NE 68127
5. Click **+** next to Files → **HTML** → name it **Index** (not Index.html; Google adds that).
   Delete what's in it and paste the whole **Index.html** file.
6. Click the save icon (or Ctrl/Cmd + S).

## 3. Put it online (3 min)
1. Click **Deploy** (top right) → **New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**.
4. Click **Authorize access** and pick jobreceiptsbtr@gmail.com.
   Google says "Google hasn't verified this app" because you wrote it yourself:
   click **Advanced** → **Go to JobReceipts (unsafe)** → **Allow**.
5. Click **Done**.

## 4. Get your office link (2 min)
1. Back in the editor, pick **setup** in the function menu in the toolbar (next to Debug) and click **Run**.
2. The **Execution log** at the bottom shows `Your office link: https://script.google.com/...`.
   Copy it. Open it on your phone and add it to your home screen.
   This link sees every receipt and the money: don't share it with the crew.

## 5. Give your crew their links (1 min each)
In the app: **Settings** → **People** → type a name → **Make link** → **Copy link** → text it to them.
They open it, tap **Add receipt**, take the photo. That's it. **Turn off** stops a link; their
receipts stay.

## Good to know
- **Jobs**: setup made a **JobReceipts jobs** folder in this account's Drive. When a receipt names
  a new job (from its PO/job line), the office confirms the name and a folder is made for it on
  approval. Receipts, change orders and invoices are filed in each job's folder.
- **Change order template (optional)**: put your change order Google Doc in this account's Drive,
  copy its ID from the address bar (the long part between `/d/` and `/edit`) and add it in
  **Project Settings** (gear on the left) → **Script properties** as `CHANGE_ORDER_TEMPLATE_ID`.
- **QuickBooks** is optional and can be connected later (see SETUP.md, step 5). Everything else
  works without it.
- **After an update**: paste the new files, then **Deploy** → **Manage deployments** → pencil →
  **Version: New version** → **Deploy**. Everyone's links keep working.
- **Markup** starts at 28% on every receipt and can be changed per receipt. To change the default,
  add `DEFAULT_MARKUP_PERCENT` in Script properties.
