using System;
using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Transport only: no database, credentials, TTS, or business logic.
class LocalPipe {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string s,uint rev,out IntPtr p,out uint size);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafePipeHandle CreateNamedPipe(string name,uint access,uint mode,uint instances,uint outSize,uint inSize,uint timeout,ref SA security);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientSessionId(SafePipeHandle h,out uint session);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeServerProcessId(SafePipeHandle h,out uint pid);
  const int MaxRequest=4*1024*1024,MaxResponse=32*1024*1024;
  static string Read(Stream stream,int max) { var r=new BinaryReader(stream,Encoding.UTF8,true); int n=r.ReadInt32(); if(n<1||n>max)throw new InvalidDataException();byte[] b=r.ReadBytes(n);if(b.Length!=n)throw new EndOfStreamException();return new UTF8Encoding(false,true).GetString(b); }
  static void Write(Stream stream,string text,int max) { byte[] b=Encoding.UTF8.GetBytes(text);if(b.Length>max)throw new InvalidDataException();var w=new BinaryWriter(stream,Encoding.UTF8,true);w.Write(b.Length);w.Write(b);w.Flush(); }
  static NamedPipeServerStream Server(string name,bool first) {
    string sid=WindowsIdentity.GetCurrent().User.Value;
    IntPtr descriptor;uint size;
    if(!ConvertStringSecurityDescriptorToSecurityDescriptor("D:P(A;;GA;;;"+sid+")",1,out descriptor,out size))throw new IOException();
    try {
      var sa=new SA{length=Marshal.SizeOf(typeof(SA)),descriptor=descriptor,inherit=0};
      // FIRST_PIPE_INSTANCE prevents squatting; REJECT_REMOTE_CLIENTS blocks SMB.
      var h=CreateNamedPipe("\\\\.\\pipe\\"+name,3U|(first?0x00080000U:0U),8U,1,65536,65536,0,ref sa);
      if(h.IsInvalid)throw new IOException("PIPE_CREATE_FAILED");
      return new NamedPipeServerStream(PipeDirection.InOut,false,false,h);
    } finally { LocalFree(descriptor); }
  }
  static int Main(string[] args) {
    Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
    try {
      if(args.Length<2||!System.Text.RegularExpressions.Regex.IsMatch(args[1],"^chigetang-agent-control-v1-[a-f0-9]{24}$"))throw new InvalidDataException();
      if(args[0]=="--client") {
        uint expected=UInt32.Parse(args[2]);
        using(var pipe=new NamedPipeClientStream(".",args[1],PipeDirection.InOut,PipeOptions.None,TokenImpersonationLevel.Identification)) {
          pipe.Connect(5000);uint actual;
          if(!GetNamedPipeServerProcessId(pipe.SafePipeHandle,out actual)||actual!=expected)throw new IOException("PIPE_SERVER_IDENTITY_REJECTED");
          string request=Console.ReadLine();if(request==null)throw new EndOfStreamException();Write(pipe,request,MaxRequest);Console.WriteLine(Read(pipe,MaxResponse));
        } return 0;
      }
      if(args[0]!="--server")throw new InvalidDataException();
      int parent=Int32.Parse(args[2]);
      var monitor=new System.Threading.Thread(()=>{while(true){System.Threading.Thread.Sleep(1000);try{if(Process.GetProcessById(parent).HasExited)Environment.Exit(0);}catch{Environment.Exit(0);}}});monitor.IsBackground=true;monitor.Start();
      var server=Server(args[1],true);
      Console.WriteLine("{\"kind\":\"ready\",\"pipeHostPid\":"+Process.GetCurrentProcess().Id+"}");
      while(true) {
        try {
          server.WaitForConnection();uint session;
          if(!GetNamedPipeClientSessionId(server.SafePipeHandle,out session)||session!=(uint)Process.GetCurrentProcess().SessionId)throw new IOException("PIPE_SESSION_REJECTED");
          string request=Read(server,MaxRequest);Console.WriteLine(request);
          string response=Console.ReadLine();if(response==null)return 0;Write(server,response,MaxResponse);server.WaitForPipeDrain();
        } catch(IOException e) { Console.Error.WriteLine("Local IPC connection closed: "+e.GetType().Name+" win32="+Marshal.GetLastWin32Error()+"; no automatic retry."); }
        finally { if(server.IsConnected)server.Disconnect(); }
      }
    } catch(Exception e) { Console.Error.WriteLine("Local IPC transport unavailable: "+e.GetType().Name+" win32="+Marshal.GetLastWin32Error()+"; no automatic retry.");return 1; }
  }
}
