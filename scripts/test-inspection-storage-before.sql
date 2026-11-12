-- LOCAL ONLY: mínima interfaz Storage para comprobar políticas sin servicios externos.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE IF NOT EXISTS storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text NOT NULL,UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,anon;
