# Supabase database trust anchor

Public root CA linked by Film For Us → Database → Settings → SSL configuration → Download certificate:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Retrieved 12 November 2026 over verified HTTPS. This is a public trust certificate, not a credential. The PostgreSQL driver adds it to Node's existing root certificates while retaining `rejectUnauthorized: true` and normal hostname verification. Connection-string SSL overrides are still removed so they cannot weaken these options. When Supabase rotates this root, verify the replacement against the authenticated project dashboard before updating it.
