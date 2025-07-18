-- Add alpha_view column to projects table
ALTER TABLE projects ADD COLUMN alpha_view BOOLEAN NOT NULL DEFAULT 0;