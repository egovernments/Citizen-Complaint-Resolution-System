import duckdb
con = duckdb.connect()
con.execute("INSTALL spatial;")
con.execute("LOAD spatial;")
con.execute("INSTALL httpfs;")
con.execute("LOAD httpfs;")

# Explore the divisions theme
print("Exploring division theme...")
try:
    res = con.execute("""
        SELECT * 
        FROM read_parquet('s3://overturemaps-us-west-2/release/2024-05-16-beta.0/theme=divisions/type=division/*') 
        LIMIT 1;
    """).fetchall()
    print(res)
    
    # See columns
    cols = con.execute("""
        DESCRIBE SELECT * FROM read_parquet('s3://overturemaps-us-west-2/release/2024-05-16-beta.0/theme=divisions/type=division/*') LIMIT 1;
    """).fetchall()
    print("Columns in division:")
    for c in cols: print(c[0])
except Exception as e:
    print(f"Error: {e}")

