#!/usr/bin/python3
import os,sys
args=sys.argv[1:]
if args and args[0] in ('create','run'):
 for i,a in enumerate(args):
  if a in ('-p','--publish') and i+1<len(args):
   val=args[i+1]
   if val.count(':')==1: args[i+1]='127.0.0.1:'+val
   elif not val.startswith('127.0.0.1:'): raise SystemExit('Unsafe non-loopback publish rejected')
  elif a.startswith('--publish='):
   val=a.split('=',1)[1]
   if val.count(':')==1: args[i]='--publish=127.0.0.1:'+val
   elif not val.startswith('127.0.0.1:'): raise SystemExit('Unsafe publish rejected')
os.execv('/Applications/Docker.app/Contents/Resources/bin/docker',['docker']+args)
