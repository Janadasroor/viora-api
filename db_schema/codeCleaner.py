import sys
import os

def clean_sql(input_file, output_file):
    print(f"Cleaning {input_file} -> {output_file}...")
    with open(input_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    ignore_keywords = [
        "OWNER TO",
        "ACL",
        "GRANT ALL",
        "REVOKE ALL",
        "SET default_table_access_method",
        "SELECT pg_catalog.set_config('search_path'",
        "\\restrict"
    ]

    cleaned_lines = []
    for line in lines:
        raw_line = line.strip()
        
        # Skip comments and empty lines
        if raw_line.startswith("--") or not raw_line:
            continue
            
        # Filter out environment-specific commands
        if any(kw in raw_line for kw in ignore_keywords):
            continue

        # Remove inline comments
        if "--" in line:
            line = line.split("--")[0].rstrip()
            if not line.strip():
                continue
        
        cleaned_lines.append(line.rstrip())

    with open(output_file, "w", encoding="utf-8") as f:
        f.write("\n".join(cleaned_lines))

    print(f"Cleaned SQL saved to {output_file}")

if __name__ == "__main__":
    # Default behavior if run without args (backward compatibility)
    target_data = "viora_pluse_v1_data.sql"
    target_schema = "viora_pluse_v1_schema.sql"
    
    if os.path.exists(target_data):
        clean_sql(target_data, "viora_pluse_v1_data_cleaned.sql")
    
    if os.path.exists(target_schema):
        clean_sql(target_schema, "viora_pluse_v1_schema_cleaned.sql")
