# Branch deletion behavior

Administrators can permanently delete a branch from **Dashboard → Branch Management**.

- Accountants remain read-only and do not see the delete control.
- The confirmation names the selected branch and warns that deletion cannot be undone.
- The delete control is disabled while a request is in progress to prevent duplicate submissions.
- Supabase RLS and foreign-key constraints remain authoritative. If the branch cannot be deleted, the dashboard keeps it and displays the server error in the existing write-error banner.
- A deleted selected branch is replaced by another active branch when one is available.
