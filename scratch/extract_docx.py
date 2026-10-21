import zipfile
import xml.etree.ElementTree as ET
import os

docx_path = "GeoIntel AI Automated Geopolitical Risk Intelligence and Real-Time Conflict Monitoring System.docx"
out_path = os.path.join("scratch", "report_extracted.txt")

with zipfile.ZipFile(docx_path) as z:
    xml_content = z.read("word/document.xml")
    tree = ET.fromstring(xml_content)
    
    # Namespaces in docx
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    
    paragraphs = []
    for p in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
        texts = [node.text for node in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t') if node.text]
        if texts:
            paragraphs.append(''.join(texts))

full_text = '\n\n'.join(paragraphs)
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(full_text)

print(f"Extracted {len(paragraphs)} paragraphs, {len(full_text)} characters.")
