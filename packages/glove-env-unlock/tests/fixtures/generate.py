"""Regenerate synthetic fixtures with pypdf 6.17.0 and cryptography 50.0.1.
No bank/customer data. Password: statement-secret-482 (empty for empty.pdf).
"""
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

for algorithm in ['AES-256', 'AES-128', 'RC4-128', 'RC4-40', 'AES-256-R5', 'empty']:
    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=400)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    content = DecodedStreamObject()
    content.set_data(b'BT /F1 14 Tf 30 300 Td (Balance: 1234.56) Tj 0 -25 Td (Account: Synthetic Checking) Tj 0 -25 Td (This is a test bank statement.) Tj 0 -25 Td (No real account data is included.) Tj 0 -25 Td (Closing balance verified for testing.) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(content)
    writer.add_metadata({'/Title': 'Bank statement'})
    writer.encrypt('' if algorithm == 'empty' else 'statement-secret-482', owner_password='owner-secret', algorithm='AES-128' if algorithm == 'empty' else algorithm)
    writer.write(Path(__file__).parent / f'{algorithm}.pdf')
