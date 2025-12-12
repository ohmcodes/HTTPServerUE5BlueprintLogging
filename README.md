# HTTPServerUE5BlueprintLogging

HTTP Server receives logging from UE5 Blueprint executions

## Blueprint:
<img width="256" height="201" alt="image" src="https://github.com/user-attachments/assets/84445775-be9d-45f2-bce0-6b4cccf4a106" />

### Create CPP Classes
for this case I used Function Library as parent and expose the function for blueprint purposes
```cpp
//.h file

UFUNCTION(BlueprintCallable, Category = "SharedSpaces|HTTP")
static void SendLogToServer(const FString& ServerURL, const FString& LogMessage);
```

```cpp
//.cpp file

#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/MessageDialog.h"

void UubcvrFunctionLibrary::SendLogToServer(const FString& ServerURL, const FString& LogMessage)
{
	// Create the HTTP request
	TSharedRef<IHttpRequest> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(ServerURL);
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));

	// Create the JSON body
	FString JsonString = FString::Printf(TEXT("{\"log\": \"%s\"}"), *LogMessage);
	Request->SetContentAsString(JsonString);

	// Bind the response handler
	Request->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr Request, FHttpResponsePtr Response, bool bWasSuccessful)
		{
			if (bWasSuccessful)
			{
				UE_LOG(LogTemp, Log, TEXT("Log successfully sent: %s"), *Response->GetContentAsString());
			}
			else
			{
				UE_LOG(LogTemp, Error, TEXT("Failed to send log"));
			}
		});

	// Send the request
	Request->ProcessRequest();
}
```

in your `Build.cs`
```
PublicDependencyModuleNames.AddRange(
	new string[] {
  ... other  dependencies
  "HTTP",
  "Json",
  "JsonUtilities",
});
```
- navigate to your http server folder
- run your nodejs server by opening a bash or cmd then type in: `node server.js`

thats it compile and enjoy!



