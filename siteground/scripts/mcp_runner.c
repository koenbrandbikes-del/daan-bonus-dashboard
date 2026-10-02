#include "quickjs.h"
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
#include <sys/resource.h>
static time_t deadline;
static int interrupt(JSRuntime *rt, void *opaque) { return time(NULL)>deadline; }
static char *readall(FILE *f,size_t *n) { size_t cap=4096; char *p=malloc(cap);*n=0; if(!p)return NULL; for(;;){if(*n==cap){cap*=2;if(cap>32*1024*1024){free(p);return NULL;}p=realloc(p,cap);if(!p)return NULL;}size_t got=fread(p+*n,1,cap-*n,f);*n+=got;if(!got)break;}p=realloc(p,*n+1);p[*n]=0;return p; }
int main(int argc,char **argv){
 if(argc!=2)return 2; struct rlimit cpu={10,10};setrlimit(RLIMIT_CPU,&cpu);alarm(12);deadline=time(NULL)+8;
 FILE *f=fopen(argv[1],"rb");if(!f)return 3;size_t ns,ni;char *script=readall(f,&ns),*input=readall(stdin,&ni);fclose(f);if(!script||!input)return 4;
 JSRuntime *rt=JS_NewRuntime();JS_SetMemoryLimit(rt,128*1024*1024);JS_SetMaxStackSize(rt,1024*1024);JS_SetInterruptHandler(rt,interrupt,NULL);JSContext *ctx=JS_NewContext(rt);
 JSValue data=JS_ParseJSON(ctx,input,ni,"input");if(JS_IsException(data))return 5;
 JSValue global=JS_GetGlobalObject(ctx);JS_SetPropertyStr(ctx,global,"__input",data);JS_FreeValue(ctx,global);
 JSValue result=JS_Eval(ctx,script,ns,"trusted-financial-model",JS_EVAL_TYPE_GLOBAL);
 if(JS_IsException(result)){JSValue e=JS_GetException(ctx);const char *s=JS_ToCString(ctx,e);fprintf(stderr,"%s\n",s?s:"Calculation failed");JS_FreeCString(ctx,s);return 6;}
 const char *s=JS_ToCString(ctx,result);if(!s)return 7;puts(s);JS_FreeCString(ctx,s);JS_FreeValue(ctx,result);JS_FreeContext(ctx);JS_FreeRuntime(rt);free(input);free(script);return 0;
}
