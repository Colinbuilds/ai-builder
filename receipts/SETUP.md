# JobReceipts setup guide

JobReceipts runs inside your company's Google Workspace as a Google Apps Script web app. It runs as the admin who installs it: employees only use the app page and never get access to your Drive, your QuickBooks or the records sheet.

Allow about 45 minutes, most of it for QuickBooks. Steps 1–5 get the phone app and office review working. Step 6 connects QuickBooks and can be done later.

## 1. Create the Apps Script project

1. Signed in with the admin's company Google account, go to **script.google.com** and click **New project**. Name it **JobReceipts**.
2. Click **Project Settings** (the gear icon) and tick **Show "appsscript.json" manifest file in editor**.
3. Go back to **Editor**. For every file in [`dist/apps-script/`](dist/apps-script/):
   - For `.gs` files, click **+ → Script**, name it without the extension (e.g. `Code`), and paste the contents.
   - For `.html` files, click **+ → HTML**, name it without the extension (e.g. `Index`), and paste the contents.
   - For `appsscript.json`, replace the existing file's contents.
4. The new project already has a `Code.gs`: replace its contents with ours instead of adding a second one. Click **Save**.

The manifest already includes the Google OAuth2 library that QuickBooks sign-in needs.

## 2. Settings

**Project Settings → Script properties → Add script property.** Add:

| Property | What to put |
|---|---|
| `ADMIN_EMAILS` | Office people who see everything, comma-separated, e.g. `colin@yourco.com, office@yourco.com` |
| `JOBS_FOLDER_ID` | Open the folder (or shared drive) that holds one folder per job. Copy the ID from the address bar: the part after `/folders/` |
| `CHANGE_ORDER_TEMPLATE_ID` | Open your change order Google Doc template and copy the ID from the address bar: the part between `/d/` and `/edit` |
| `COMPANY_NAME` / `COMPANY_ADDRESS` | Shown on invoices |
| `ANTHROPIC_API_KEY` | See step 4 |

Optional settings, with their defaults:

| Property | Default | Meaning |
|---|---|---|
| `DEFAULT_MARKUP_PERCENT` | `15` | Starting markup on every receipt (changeable per receipt) |
| `INCLUDE_TAX_IN_COST` | `true` | Count sales tax paid as part of your cost |
| `RECEIPTS_SUBFOLDER` | `Receipts` | Where approved receipts are filed inside each job folder |
| `CHANGE_ORDERS_PATH` | `Project Management/Change Orders` | Where change orders are saved inside each job folder |
| `INVOICES_SUBFOLDER` | `Invoices` | Where invoices are saved inside each job folder |

**How the change order template is filled:** the app looks in the template's tables for these labels and writes the value in the cell to the right of each one: PROJECT NAME, LOCATION OF WORK, PROJECT MANAGER, DATE OF REQUEST, DESCRIPTION OF CHANGES NEEDED, REASON FOR CHANGE, NET INCREASE / DECREASE, and TOTAL CONTRACT PRICE WITH APPROVED CHANGES. A materials table, with the vendor on every line, is added above the line that starts with "Signature". Signature names and dates are left blank for people to sign.

## 3. Run setup once

1. In the editor, choose **setup** from the function menu and click **Run**.
2. Google asks for permission. Click **Review permissions**, choose the admin account, then **Advanced → Go to JobReceipts** and **Allow**.

This creates a **JobReceipts records** sheet and a **JobReceipts inbox** folder in the admin's Drive.

## 4. Turn on AI receipt reading

1. At **console.anthropic.com**, add billing credits, then go to **API keys → Create key**.
2. Paste the key into the `ANTHROPIC_API_KEY` script property.

Each receipt costs a few cents to read.

## 5. Publish the app to your team

1. Click **Deploy → New deployment**. Choose the type **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone within** your company domain. Click **Deploy** and copy the **Web app URL**.
3. Send the link to employees. On a phone, open it and choose **Add to Home Screen** so it works like an app.

Employees sign in with their company Google account. They see **Add receipt** and **My receipts**, and only their own receipts. Admins also see **Review**, **All receipts**, **Jobs** and **Settings**.

After you change any code, go to **Deploy → Manage deployments → Edit → Version: New version** so everyone gets the update.

## 6. Connect QuickBooks Online

1. At **developer.intuit.com**, sign in and click **Create an app → QuickBooks Online and Payments**, then choose the **com.intuit.quickbooks.accounting** scope.
2. Under **Keys & credentials**, add the redirect URI `https://script.google.com/macros/d/SCRIPT_ID/usercallback`. Replace `SCRIPT_ID` with the **Script ID** from Apps Script **Project Settings**.
3. Copy the **Client ID** and **Client Secret** into the `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` script properties. Intuit makes you fill in a short questionnaire before issuing production keys.
4. In QuickBooks:
   - Create a **Non-inventory** product/service called **Materials**. To use another name, set `QBO_MATERIALS_ITEM`.
   - Make sure an expense account named **Job Materials** exists. To use another, set `QBO_EXPENSE_ACCOUNT`.
   - Set `QBO_PAYMENT_ACCOUNT` to the exact name of the card or bank account the store purchases come out of. Set `QBO_PAYMENT_TYPE` to `CreditCard`, `Cash` or `Check`.
5. Open the app, go to **Settings**, click **Connect QuickBooks** and approve.

**What each approval sends to QuickBooks:**

| In the app | In QuickBooks |
|---|---|
| Change order | An **Estimate** for the customer, memo "Change Order #N - job name" |
| Invoice | An **Invoice** for the customer |
| Every approval | An **Expense** for your real cost, from the vendor, assigned to the customer so job profit reports are right |

The customer is named exactly like the job folder and is created the first time if it doesn't exist. Every line names the vendor. Until QuickBooks is connected, approvals still create the documents, and the receipt shows "QuickBooks not connected".


## Good to know

- **Nothing reaches customers or QuickBooks until an admin clicks Approve.**
- If the job an employee picked doesn't match what's printed on the receipt, the receipt is held with a warning.
- Receipts that fail to read (for example, a blurry photo or the AI being busy) stay in the list with the reason and a **Read it again** button.
- iPhone photos are converted to JPEG in the browser before upload. If a photo won't open, set **Settings → Camera → Formats → Most Compatible**.
