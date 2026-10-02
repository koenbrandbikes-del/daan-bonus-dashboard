"""Use the same financial JS modules in the bounded, network-free server runtime."""
import pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[2]
def model():
    parts=[]
    for path in ['assets/product-costs.js','assets/blended/data.js','assets/blended/return-reserve.js','assets/blended/metrics.js','assets/blended/meta-review.js','assets/blended/mcp-finance.js']:
        source=(ROOT/path).read_text()
        source=re.sub(r'^import[^\n]*\n','',source,flags=re.M)
        source=re.sub(r'\bexport (?=(?:async )?(?:function|const|let|class))','',source)
        parts.append(source)
    return '\n'.join(parts)+'\nJSON.stringify(__input.health===true ? {ready:finance([{num:\'health\',d:\'2026-08-05\',incl:121,items:[\'health\']}],{items:{health:20},assumed_vat:.21,payment_rate:.02,overhead_rate:.04}).excl===100} : mcpRun(__input));\n'
if __name__=='__main__':print(model())
