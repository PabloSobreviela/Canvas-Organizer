import os
import docx
import pdfplumber


def extract_text_from_pdf_with_tables(path):
    """Extract text from PDF using pdfplumber, with table-aware extraction.
    
    Tables are converted to markdown format for better AI parsing.
    """
    extracted_content = []
    
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            # Extract regular text
            text = page.extract_text()
            if text:
                extracted_content.append(text)
            
            # Extract tables and convert to markdown
            tables = page.extract_tables()
            for table in tables:
                if table:
                    # Convert table to markdown
                    markdown_table = table_to_markdown(table)
                    extracted_content.append("\n\n" + markdown_table + "\n\n")
    
    return "\n".join(extracted_content)


def table_to_markdown(table):
    """Convert a table (list of lists) to markdown format."""
    if not table or not table[0]:
        return ""
    
    markdown_lines = []
    
    # Header row
    header = table[0]
    # Clean None values and convert to strings
    header = [str(cell).strip() if cell else "" for cell in header]
    markdown_lines.append("| " + " | ".join(header) + " |")
    
    # Separator
    markdown_lines.append("|" + "|".join(["---" for _ in header]) + "|")
    
    # Data rows
    for row in table[1:]:
        row = [str(cell).strip() if cell else "" for cell in row]
        markdown_lines.append("| " + " | ".join(row) + " |")
    
    return "\n".join(markdown_lines)


def extract_text_from_file(path):
    ext = path.split(".")[-1].lower()

    if ext == "pdf":
        return extract_text_from_pdf_with_tables(path)

    elif ext == "docx":
        doc = docx.Document(path)
        return "\n".join(p.text for p in doc.paragraphs)

    elif ext == "txt":
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    else:
        return ""
