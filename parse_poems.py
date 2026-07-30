#!/usr/bin/env python3
"""
Parse John Donne poems from Project Gutenberg HTML file
"""
import json
import re

def parse_poems(input_file):
    """Parse poems from the fetched Gutenberg HTML file"""
    
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    poems = []
    
    # Split by lines and parse
    lines = content.split('\n')
    
    current_poem = None
    current_lines = []
    in_poem = False
    poem_title = None
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        # Look for poem titles (headers starting with ###)
        if line.startswith('### ') and not line.startswith('### LIST'):
            potential_title = line.replace('### ', '').strip()
            
            # Skip non-poem headers
            if any(skip in potential_title.lower() for skip in ['preface', 'note', 'contents', 'list of', 'index']):
                i += 1
                continue
            
            # If we were building a poem, save it
            if current_poem and current_lines:
                current_poem['content'] = '\n'.join(current_lines)
                if len(current_poem['content'].strip()) > 20:  # Only save if substantial
                    poems.append(current_poem)
            
            # Start new poem
            poem_title = potential_title
            current_poem = {
                'title': poem_title,
                'content': ''
            }
            current_lines = []
            in_poem = True
            i += 1
            continue
        
        # Skip separator lines
        if line == '---' or line.startswith('[page'):
            i += 1
            continue
        
        # If we're in a poem and hit notes/variants (lines with numbers like "3 past yeares]")
        if in_poem and current_poem:
            # Check if this looks like a textual note
            if re.match(r'^\d+\s+\w+.*\]\s*', line) or re.match(r'^\d+-\d+\s+', line):
                # This is a note, save the poem and stop
                if current_lines:
                    current_poem['content'] = '\n'.join(current_lines)
                    if len(current_poem['content'].strip()) > 20:
                        poems.append(current_poem)
                current_poem = None
                current_lines = []
                in_poem = False
                i += 1
                continue
        
        # Collect poem lines
        if in_poem and current_poem:
            # Skip empty lines at the start
            if not current_lines and not line:
                i += 1
                continue
            
            # Add the line (keep formatting)
            if line or current_lines:  # Keep empty lines in the middle of poems
                current_lines.append(line)
        
        i += 1
    
    # Save last poem if any
    if current_poem and current_lines:
        current_poem['content'] = '\n'.join(current_lines)
        if len(current_poem['content'].strip()) > 20:
            poems.append(current_poem)
    
    return poems

def clean_poems(poems):
    """Clean up parsed poems"""
    cleaned = []
    
    for poem in poems:
        # Clean up content
        content = poem['content']
        
        # Remove lines that are clearly notes or manuscript references
        lines = content.split('\n')
        clean_lines = []
        
        for line in lines:
            # Skip lines that look like manuscript notes
            if re.match(r'^[A-Z0-9\s,]+\d{4}[-,]', line):
                break
            if re.match(r'^\w+\.\s+\d{4}', line):
                break
            clean_lines.append(line)
        
        content = '\n'.join(clean_lines).strip()
        
        if content and len(content) > 20:
            # Extract first line for preview
            first_line = content.split('\n')[0][:100]
            
            cleaned.append({
                'title': poem['title'],
                'content': content,
                'firstLine': first_line
            })
    
    return cleaned

if __name__ == '__main__':
    input_file = '/home/ubuntu/.cursor/projects/workspace/agent-tools/f969c3cd-f7cd-4da1-bf7c-c2c98271ff93.txt'
    output_file = '/workspace/poetry-website/poems.json'
    
    print("Parsing poems from Project Gutenberg...")
    poems = parse_poems(input_file)
    print(f"Found {len(poems)} poems")
    
    print("Cleaning poems...")
    poems = clean_poems(poems)
    print(f"Cleaned to {len(poems)} poems")
    
    # Save to JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(poems, f, indent=2, ensure_ascii=False)
    
    print(f"Saved {len(poems)} poems to {output_file}")
    
    # Print first few titles
    print("\nFirst 10 poems:")
    for i, poem in enumerate(poems[:10]):
        print(f"{i+1}. {poem['title']}")
